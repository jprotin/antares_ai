// Source SSE de test : un morceau toutes les 300 ms (vérifie que le proxy ne tamponne pas)
import { createServer } from "node:http";
createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  let n = 0;
  const timer = setInterval(() => {
    n += 1;
    res.write(`data: {"choices":[{"delta":{"content":"${n} "}}]}\n\n`);
    if (n === 6) {
      clearInterval(timer);
      res.end("data: [DONE]\n\n");
    }
  }, 300);
}).listen(18765, "127.0.0.1");
