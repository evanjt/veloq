// Drives the app's map page over the WebView devtools socket for the light
// heatmap contrast capture: evaluates one expression, awaiting a promise, and
// prints the result as JSON.
//
// node scripts/measure/heatmap-light-contrast.mjs <devtools ws url> '<expression>'
const [ws, expression] = process.argv.slice(2);
const socket = new WebSocket(ws);
socket.onopen = () =>
  socket.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    })
  );
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== 1) return;
  const { result, exceptionDetails } = message.result;
  if (exceptionDetails) {
    console.error(JSON.stringify(exceptionDetails));
    process.exit(1);
  }
  console.log(JSON.stringify(result.value));
  socket.close();
};
socket.onerror = (error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
};
