
import { build } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

async function runBuild() {
  try {
    console.log('Starting programmatic build via Vite API...');
    await build({
      configFile: join(process.cwd(), 'vite.config.ts'),
      build: {
        minify: false, // 일단 꺼둠
      }
    });
    console.log('Build completed successfully!');
  } catch (error) {
    console.error('Build failed with error:');
    console.error(error);
    process.exit(1);
  }
}

runBuild();
