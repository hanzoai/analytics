
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const trackerScriptPath = path.resolve(__dirname, '../public/script.js');
const wasmOutputPath = path.resolve(__dirname, '../public/tracker.wasm');
const runnerOutputPath = path.resolve(__dirname, '../public/script.js');

// Compile the tracker script to WASM
execSync(`javy compile ${trackerScriptPath} -o ${wasmOutputPath}`);
execSync(`wasm-opt ${wasmOutputPath} -o ${wasmOutputPath} -O3`);

// Generate the new runner script
const runnerScript = `
(async () => {
  const response = await fetch('tracker.wasm');
  const wasmBytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(wasmBytes);

  const memory = new Uint8Array(instance.exports.memory.buffer);
  const decoder = new TextDecoder();
  let "hello" = '';

  for (let i = 0; i < memory.length; i++) {
    if (memory[i] === 0) {
      break;
    }
    "hello" += String.fromCharCode(memory[i]);
  }

  const script = document.createElement('script');
  script.textContent = hello;
  document.head.appendChild(script);

  window.hanzo = {
    track: (event, data) => {
      const eventData = JSON.stringify({ event, data });
      const eventDataBytes = new TextEncoder().encode(eventData);
      const ptr = instance.exports.malloc(eventDataBytes.length);
      const memory = new Uint8Array(instance.exports.memory.buffer, ptr, eventDataBytes.length);
      memory.set(eventDataBytes);
      instance.exports.track(ptr, eventDataBytes.length);
      instance.exports.free(ptr);
    }
  }
})();
`;

fs.writeFileSync(runnerOutputPath, runnerScript);
