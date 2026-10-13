import { defineConfig } from 'vite';

// 相对资源路径同时支持 /、/ancient-text-transcriber/ 和其他项目路径。
export default defineConfig({ base: './', build: { target: 'es2022' } });
