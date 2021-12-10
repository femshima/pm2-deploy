
import dotenv from "dotenv";
dotenv.config();

import apiType from "./apiType";

const apiKey = process.env.RELAY_KEY ?? "";
const apiSecret = process.env.RELAY_SECRET ?? "";
const buckets = process.env.BUCKET?.split(",");
const internalAppKey = process.env.APPSECRET;

import { WebhookRelayClient } from "webhookrelay-ws-client";


import ChildProcess from "child_process";
import util from "util";
const exec = util.promisify(ChildProcess.exec);


import simpleGit, { SimpleGit } from 'simple-git';
const git: SimpleGit = simpleGit();


import pm2, { ProcessDescription, Proc, StartOptions } from "pm2";


import concurrently from "concurrently";


function pm2list() {
    return new Promise<ProcessDescription[]>((resolve, reject) => {
        pm2.list((err, list) => {
            if (err) {
                reject(err);
            } else {
                resolve(list);
            }
        });
    });
}
function pm2delete(process: string | number) {
    return new Promise<Proc>((resolve, reject) => {
        pm2.delete(process, (err, proc) => {
            if (err) {
                reject(err);
            } else {
                resolve(proc);
            }
        })
    })
}

interface data {
    internalAppKey?: string,
    appName?: string,
    commit?: string,
    branch?: string
}

let handler = async function (data_s: string) {
    const req = JSON.parse(data_s) as apiType;
    if (req.type === "webhook") {
        const data = JSON.parse(req.body) as data;
        if (data.internalAppKey !== internalAppKey) {
            console.log("Auth failed");
            return;
        }
        const appName = data.appName;
        if (!appName) {
            console.log("No appName Provided");
            return;
        }
        const list = await pm2list();
        const installed = list.find((proc: ProcessDescription) => proc.name === appName);
        if (!installed) {
            console.log("Program is not installed:", appName);
            return;
        }
        const pid = installed.pid;
        const path = installed.pm2_env?.pm_cwd;
        if (!pid) {
            console.log("Invalid PID:", installed);
            return;
        }
        if (!path) {
            console.log("No CWD found:", installed);
            return;
        }

        const cwd = process.cwd();
        process.chdir(path);

        if (installed.name !== "pm2-deploy") {
            //not self-update
            //delete the process
            await pm2delete(pid);
        }

        //git fetch&git merge
        await git.cwd(path);
        const branch = data.branch;
        if (branch && /(\w|\d|[\\\/.@])+/) {
            await git.fetch("origin", branch);
        } else {
            await git.fetch();
        }
        const commit = data.commit;
        if (commit && /^[0-9a-f]+$/.test(commit)) {
            await git.merge([commit]);
        } else {
            await git.merge(["FETCH_HEAD"]);
        }

        //execute npm script
        await concurrently([{ command: "npm run build", cwd: path }]).catch(() => { });

        //start!
        await exec("pm2 start pm2.json");

        if (installed.name === "pm2-deploy") {
            await pm2delete(pid);
        }

        process.chdir(cwd);

    }
    return;
}

let run = function () {
    let client = new WebhookRelayClient(apiKey, apiSecret, buckets, handler)
    client.connect();

    // do some work

    // disconnect whenever connection is no longer needed
    setTimeout(function () {
        console.log('disconnecting')
        client.disconnect();
        pm2.disconnect();
    }, 100000);
}

pm2.connect((err) => {
    if (err) {
        console.log(err);
        return;
    }
    run();
});