const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const trackerScriptPath = path.resolve(__dirname, '../public/script.js');
const encryptedTrackerPath = path.resolve(__dirname, '../public/data.bin');
const wasmDeobfuscatorPath = path.resolve(__dirname, '../public/loader.wasm');
const loaderScriptPath = path.resolve(__dirname, '../public/script.js');

// 1. Obfuscate the tracker API
let trackerScript = fs.readFileSync(trackerScriptPath, 'utf8');
trackerScript = trackerScript.replace(/window\.umami/g, 'window.app');
trackerScript = trackerScript.replace(/track/g, 'send');

// 2. Encrypt the script
const key = 'secret';
const encryptedScript = Buffer.from(trackerScript).map((byte, i) => byte ^ key.charCodeAt(i % key.length));
fs.writeFileSync(encryptedTrackerPath, encryptedScript);

// 3. Compile a WASM deobfuscator
const watDeobfuscator = `
(module
  (memory (export "memory") 1)
  (func (export "deobfuscate") (param $dataPtr i32) (param $dataLen i32) (param $keyPtr i32) (param $keyLen i32)
    (local $i i32)
    (loop $loop
      (if (i32.ge_u (local.get $i) (local.get $dataLen)) (then (return)))
      (i32.store8
        (i32.add (local.get $dataPtr) (local.get $i))
        (i32.xor
          (i32.load8_u (i32.add (local.get $dataPtr) (local.get $i)))
          (i32.load8_u (i32.add (local.get $keyPtr) (i32.rem_u (local.get $i) (local.get $keyLen))))
        )
      )
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $loop)
    )
  )
)
`;
fs.writeFileSync('deobfuscator.wat', watDeobfuscator);
execSync(`npx wat2wasm deobfuscator.wat -o ${wasmDeobfuscatorPath}`);
fs.unlinkSync('deobfuscator.wat');

// 4. Generate a new loader script
const loaderScript = `
(async () => {
  try {
    const [encryptedTrackerRes, wasmDeobfuscatorRes] = await Promise.all([
      fetch('data.bin'),
      fetch('loader.wasm'),
    ]);

    const encryptedTracker = await encryptedTrackerRes.arrayBuffer();
    const wasmDeobfuscator = await wasmDeobfuscatorRes.arrayBuffer();

    const { instance } = await WebAssembly.instantiate(wasmDeobfuscator);
    const key = new TextEncoder().encode('secret');

    const memory = instance.exports.memory;
    const requiredMemory = encryptedTracker.byteLength + key.length;
    const pagesNeeded = Math.ceil(requiredMemory / (64 * 1024));
    if (pagesNeeded > memory.buffer.byteLength / (64 * 1024)) {
        memory.grow(pagesNeeded - (memory.buffer.byteLength / (64 * 1024)));
    }
    
    const memArray = new Uint8Array(memory.buffer);

    const trackerPtr = 0;
    const keyPtr = encryptedTracker.byteLength;

    memArray.set(new Uint8Array(encryptedTracker), trackerPtr);
    memArray.set(key, keyPtr);

    instance.exports.deobfuscate(trackerPtr, encryptedTracker.byteLength, keyPtr, key.length);

    const decryptedTrackerBytes = memArray.slice(trackerPtr, trackerPtr + encryptedTracker.byteLength);
    const decryptedScript = new TextDecoder().decode(decryptedTrackerBytes);

    const script = document.createElement('script');
    script.textContent = decryptedScript;
    document.head.appendChild(script);
  } catch (e) {
    console.error('Tracker failed to load:', e);
  }
})();
`;
fs.writeFileSync(loaderScriptPath, loaderScript);