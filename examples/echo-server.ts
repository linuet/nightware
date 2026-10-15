import { WebSocketServer } from "ws";

const server = new WebSocketServer({ port: 9001 });
server.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "hello", message: "Nightwire demo connected" }));
  socket.on("message", (message) => {
    socket.send(JSON.stringify({ type: "echo", received: message.toString(), at: new Date().toISOString() }));
  });
});
console.log("Demo server: ws://localhost:9001");
