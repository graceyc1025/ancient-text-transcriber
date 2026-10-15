import {defineConfig} from 'vite';
export default defineConfig({base:'./',build:{chunkSizeWarningLimit:20000},server:{fs:{allow:['../..']}}});
