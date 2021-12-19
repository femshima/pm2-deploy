
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


import pm2, { ProcessDescription } from "pm2";

import concurrently from "concurrently";

import lockfile from "proper-lockfile";


import Verify from "./verify";
let verify: Verify;

interface APIData {
    internalAppKey?: string,
    appName?: string,
    commit?: string,
    branch?: string
}


let handler = async function (data_s: string) {
    const req = JSON.parse(data_s) as apiType;
    if (req.type === "webhook") {
        const data = JSON.parse(req.body) as APIData;
        console.log(data);
        if (data.internalAppKey !== internalAppKey) {
            console.log("Auth failed");
            return;
        }
        const appName = data.appName;
        if (!appName) {
            console.log("No appName Provided");
            return;
        }
        const list = await util.promisify(pm2.list)();
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
            await util.promisify(pm2.delete)(pid);
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


        if (installed.name === "pm2-deploy") {
            const list2 = await util.promisify(pm2.list)();
            const anotherProcess =
                list2.find((proc: ProcessDescription) =>
                    proc.name === "pm2-deploy" &&
                    proc.pid !== process.pid
                );
            const pid = anotherProcess?.pid;

            pid && await util.promisify(pm2.reload)(pid);

            const updateresult = await verify.do();

            //失敗してもロールバックしない(複雑になって面倒)
            if (updateresult) {
                //exit(pm2 will restart this program)
                process.exit(0);
            }
        } else {
            //start!
            await exec("pm2 start pm2.json");
        }

        process.chdir(cwd);

    }
    return;
}

async function app() {
    await util.promisify(pm2.connect)();
    verify = new Verify();
    process.on("exit", () => {
        // disconnect whenever connection is no longer needed
        console.log('disconnecting')
        pm2.disconnect();
    });
    process.on("SIGINT", () => process.exit(0));
}

let client: WebhookRelayClient | undefined;

async function webhook() {
    const release = await lockfile.lock('.lock');
    console.log("Acquired Lock. Starting...");
    client = new WebhookRelayClient(apiKey, apiSecret, buckets, handler)
    client.connect();
    process.on("exit", () => {
        client && client.disconnect();
        release();
    });
}

app()
    .then(() => {
        webhook()
            .catch(() => {
                let retry = true;
                console.log("Lock failed.\nRetry lock...");
                setInterval(() => {
                    if (retry) {
                        console.log("Retry lock...");
                        webhook()
                            .catch(() => {
                                console.log("Lock failed.");
                                retry = true;
                            });
                        retry = false;
                    }
                }, 60000)
            });
    });


