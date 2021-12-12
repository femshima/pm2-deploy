import pm2, { ProcessDescription } from "pm2";
import util from "util";
import * as datefns from "date-fns";

interface Packet<T> {
    id: number,
    type: "process:msg",
    topic: true,
    data: T
}
interface VerifyData {
    type: "VerifyRequest" | "VerifyResponse",
    pid: number
}

function isPacket(arg: any): arg is Packet<VerifyData> {
    return arg.type === "process:msg" &&
        (
            arg.data.type === "VerifyRequest" ||
            arg.data.type === "VerifyResponse"
        )
}


export default class Verify {
    private lastMessage: {
        [pid: number]: Date
    } = {};
    constructor() {
        process.on("message", message => {
            if (isPacket(message)) {
                if (message.data.type === "VerifyRequest") {
                    const VerifyResponse: Packet<VerifyData> = {
                        id: message.data.pid,
                        type: "process:msg",
                        topic: true,
                        data: { type: "VerifyResponse", pid: process.pid }
                    }
                    util.promisify(pm2.sendDataToProcessId)(message.data.pid, VerifyResponse);
                } else if (message.data.type === "VerifyResponse") {
                    this.lastMessage[message.data.pid] = new Date();
                }
            }
        });
    }
    async do() {
        const start = new Date();
        let target: ProcessDescription | undefined;
        while (datefns.compareAsc(datefns.addMinutes(start, 5), new Date()) <= 0) {
            const list = await util.promisify(pm2.list)();
            target = list.find((proc: ProcessDescription) =>
                proc.name === "pm2-deploy" &&
                proc.pid !== process.pid
            );
            if (target?.pid) break;
            await util.promisify(setTimeout)(3000);
        }
        if (!target?.pid) return false;
        const VerifyRequest: Packet<VerifyData> = {
            id: target.pid,
            type: "process:msg",
            topic: true,
            data: { type: "VerifyRequest", pid: process.pid }
        }
        while (datefns.compareAsc(datefns.addMinutes(start, 5), new Date()) <= 0) {
            await util.promisify(pm2.sendDataToProcessId)(target.pid, VerifyRequest);
            await util.promisify(setTimeout)(1000);
            if (
                this.lastMessage[target.pid] &&
                datefns.compareAsc(start, this.lastMessage[target.pid]) > 0
            ) {
                return true;
            }
            await util.promisify(setTimeout)(4000);
        }
        return false;
    }
}
