import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = Number.parseInt(process.env.LOG_VIEWER_PORT ?? "4080", 10);
const tailLines = Number.parseInt(process.env.LOG_VIEWER_TAIL ?? "200", 10);
const customCommand = process.env.LOG_VIEWER_CMD?.trim();

const indexHtml = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const clients = new Set();
let processState = {
    status: "starting",
    command: "",
    pid: null,
    startedAt: new Date().toISOString(),
};

function stripAnsi(input) {
    return input.replace(
        // eslint-disable-next-line no-control-regex
        /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
        "",
    );
}

function writeEvent(response, event, data) {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
    for (const client of clients) {
        writeEvent(client, event, data);
    }
}

function detectCommand() {
    if (customCommand) {
        return {
            command: customCommand,
            args: [],
            shell: true,
            label: customCommand,
        };
    }

    const composePath = path.join(process.cwd(), "docker-compose.yml");
    if (fs.existsSync(composePath)) {
        return {
            command: "docker",
            args: ["compose", "logs", "-f", "--tail", String(tailLines), "--timestamps"],
            shell: false,
            label: `docker compose logs -f --tail ${tailLines} --timestamps`,
        };
    }

    return {
        command: "tail",
        args: ["-n", String(tailLines), "-F", "dist/index.js"],
        shell: false,
        label: `tail -n ${tailLines} -F dist/index.js`,
    };
}

function emitChunk(source, chunk) {
    const lines = stripAnsi(String(chunk))
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);

    for (const line of lines) {
        broadcast("log", {
            source,
            line,
            at: new Date().toISOString(),
        });
    }
}

function startLogProcess() {
    const target = detectCommand();
    processState = {
        status: "running",
        command: target.label,
        pid: null,
        startedAt: new Date().toISOString(),
    };

    const child = spawn(target.command, target.args, {
        cwd: process.cwd(),
        shell: target.shell,
        env: process.env,
    });

    processState.pid = child.pid ?? null;
    broadcast("status", processState);
    broadcast("system", {
        level: "info",
        message: `Streaming started: ${target.label}`,
        at: new Date().toISOString(),
    });

    child.stdout.on("data", (chunk) => emitChunk("stdout", chunk));
    child.stderr.on("data", (chunk) => emitChunk("stderr", chunk));

    child.on("error", (error) => {
        processState = {
            ...processState,
            status: "error",
        };
        broadcast("status", processState);
        broadcast("system", {
            level: "error",
            message: `Log process failed: ${error.message}`,
            at: new Date().toISOString(),
        });
    });

    child.on("close", (code, signal) => {
        processState = {
            ...processState,
            status: "stopped",
        };
        broadcast("status", processState);
        broadcast("system", {
            level: code === 0 ? "info" : "warn",
            message: `Log process stopped (code=${code ?? "null"}, signal=${signal ?? "null"})`,
            at: new Date().toISOString(),
        });
    });
}

const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (url.pathname === "/health") {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, ...processState }));
        return;
    }

    if (url.pathname === "/events") {
        response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        });
        response.write("\n");
        clients.add(response);
        writeEvent(response, "status", processState);

        request.on("close", () => {
            clients.delete(response);
        });
        return;
    }

    if (url.pathname === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(indexHtml);
        return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
});

startLogProcess();

server.listen(port, "0.0.0.0", () => {
    console.log(`Log viewer running on http://0.0.0.0:${port}`);
});
