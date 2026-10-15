export const RULES_VERSION='exact-unicode-v1';
export function comparisonText(text,whitespace='layout'){
  if(typeof text!=='string')throw new Error('标准和候选必须是文字。');
  if(!['layout','strict'].includes(whitespace))throw new Error('未知空白比较规则。');
  return whitespace==='layout'?text.replace(/[ \t\r\n]/g,''):text;
}
// Exact code points: no NFC/NFKC, simplified/traditional or variant folding.
export function evaluate(reference,candidate,{whitespace='layout',reviewed=true}={}){
  const a=Array.from(comparisonText(reference,whitespace)),b=Array.from(comparisonText(candidate,whitespace));
  const base={rulesVersion:RULES_VERSION,whitespace,referenceCharacters:a.length,candidateCharacters:b.length,CER:null,scorable:false};
  if(!a.length)return {...base,reason:'没有标准转录文本，仅记录候选。'};
  if(!reviewed)return {...base,reason:'尚未声明标准稿已逐字人工校对。'};
  if(a.some(c=>c==='□'||c==='�'))return {...base,reason:'标准含□或编码替代字符，无法确定原字；不作通配符，不计算CER。'};
  if([...a,...b].some(c=>c.length===1&&c.charCodeAt(0)>=0xd800&&c.charCodeAt(0)<=0xdfff))return {...base,reason:'文字含不完整的Unicode代理项。'};
  if((a.length+1)*(b.length+1)>4_000_000)return {...base,reason:'逐字对齐超过400万格，请裁小区域后比较；原始识别仍保留。'};
  const width=b.length+1,directions=new Uint8Array((a.length+1)*width);let previous=Uint32Array.from({length:width},(_,j)=>j);
  for(let j=1;j<width;j++)directions[j]=2;
  for(let i=1;i<=a.length;i++){
    const row=new Uint32Array(width);row[0]=i;directions[i*width]=1;
    for(let j=1;j<width;j++){
      const diag=previous[j-1]+Number(a[i-1]!==b[j-1]),del=previous[j]+1,ins=row[j-1]+1;
      const direction=diag<=del&&diag<=ins?0:del<=ins?1:2;
      row[j]=direction===0?diag:direction===1?del:ins;directions[i*width+j]=direction;
    }previous=row;
  }
  let i=a.length,j=b.length,substitutions=0,deletions=0,insertions=0;const alignment=[];
  while(i||j){const direction=directions[i*width+j];
    if(i&&j&&direction===0){const equal=a[i-1]===b[j-1];if(!equal)substitutions++;alignment.push({type:equal?'match':'substitution',referenceIndex:i,candidateIndex:j,expected:a[i-1],observed:b[j-1]});i--;j--;}
    else if(i&&(!j||direction===1)){deletions++;alignment.push({type:'deletion',referenceIndex:i,candidateIndex:null,expected:a[i-1],observed:''});i--;}
    else{insertions++;alignment.push({type:'insertion',referenceIndex:null,candidateIndex:j,expected:'',observed:b[j-1]});j--;}
  }
  alignment.reverse();const distance=previous[b.length];
  return {...base,scorable:true,reason:null,substitutions,deletions,insertions,distance,CER:distance/a.length,correctAlignedCharacters:a.length-substitutions-deletions,alignment};
}

export function columnBoxes({columnCount=3,columnCuts='',orientation='vertical'}={}){
  if(!['vertical','horizontal'].includes(orientation))throw new Error('未知文字排版。');
  let cuts;
  if(String(columnCuts).trim()){
    cuts=String(columnCuts).trim().split(/[,，;；\s]+/u).map(Number);
    if(cuts.length<2||cuts.length>31||cuts.some(x=>!Number.isFinite(x))||cuts[0]!==0||cuts.at(-1)!==100||cuts.some((x,i)=>i&&x<=cuts[i-1]))throw new Error('分栏边界须从左至右严格递增，以0开始、100结束，最多30栏。');
    cuts=cuts.map(x=>x/100);
  }else{
    const n=Number(columnCount);if(!Number.isInteger(n)||n<1||n>30)throw new Error('分栏列数必须为1–30的整数。');cuts=Array.from({length:n+1},(_,i)=>i/n);
  }
  const boxes=cuts.slice(0,-1).map((x,i)=>[x,0,cuts[i+1]-x,1]);return orientation==='vertical'?boxes.reverse():boxes;
}

export function rawTSVLines(tsv){
  if(typeof tsv!=='string')throw new Error('引擎未返回TSV。');
  const lines=new Map();
  for(const row of tsv.split('\n')){
    const p=row.replace(/\r$/,'').split('\t'),level=Number(p[0]);if(![4,5].includes(level)||p.length<11)continue;
    const key=p.slice(1,5).join('/');if(!lines.has(key))lines.set(key,{words:[],box:null});const line=lines.get(key),box=p.slice(6,10).map(Number);
    if(!box.every(Number.isFinite))throw new Error('引擎TSV坐标无效。');
    if(level===4)line.box=box;
    else{const text=p.slice(11).join('\t');if(text.trim())line.words.push({text,box,order:Number(p[5])});}
  }
  return [...lines.values()].filter(l=>l.words.length).map(line=>{
    const xs=line.words.map(w=>w.box[0]),ys=line.words.map(w=>w.box[1]);
    const [x,y,w,h]=line.box||[Math.min(...xs),Math.min(...ys),Math.max(...line.words.map(w=>w.box[0]+w.box[2]))-Math.min(...xs),Math.max(...line.words.map(w=>w.box[1]+w.box[3]))-Math.min(...ys)];
    return {poly:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],text:line.words.sort((a,b)=>a.order-b.order).map(w=>w.text).join('')};
  });
}
