// Đẩy dữ liệu realtime xuống frontend qua Socket.IO
const { Server } = require('socket.io');

let io = null;

function init(httpServer) {
  io = new Server(httpServer, { cors: { origin: '*' } });
  io.on('connection', (socket) => {
    console.log(`[ws] client connected ${socket.id}`);
    socket.on('disconnect', () => console.log(`[ws] client disconnected ${socket.id}`));
  });
  return io;
}

function emit(event, data) {
  if (io) io.emit(event, data);
}

module.exports = { init, emit };

