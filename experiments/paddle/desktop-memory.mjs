import {readFile} from 'node:fs/promises';
export async function processMemory(session){
  try{const {processInfo}=await session.send('SystemInfo.getProcessInfo');let pss=0,rss=0,privateKB=0;
    for(const process of processInfo){const text=await readFile(`/proc/${process.id}/smaps_rollup`,'utf8'),n=key=>Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`,'m'))?.[1]||0);pss+=n('Pss');rss+=n('Rss');privateKB+=n('Private_Clean')+n('Private_Dirty');}
    return {pssMiB:pss/1024,rssMiB:rss/1024,privateMiB:privateKB/1024,processes:processInfo.length};
  }catch(error){return {pssMiB:null,unavailable:error.message};}
}
