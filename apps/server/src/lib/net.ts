import net from 'node:net';

export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findFreePort(start: number, host = '127.0.0.1', attempts = 30): Promise<number> {
  for (let i = 0; i < attempts; i++) {
    const port = start + i;
    if (port > 65535) break;
    if (await isPortFree(port, host)) return port;
  }
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ port: 0, host, exclusive: true }, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}
