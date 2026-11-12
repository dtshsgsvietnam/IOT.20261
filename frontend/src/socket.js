import { io } from 'socket.io-client';

// Cùng origin (nginx / vite proxy chuyển /socket.io sang backend)
export const socket = io(import.meta.env.VITE_API_URL || '/', {
  path: '/socket.io',
  transports: ['websocket', 'polling'],
});

