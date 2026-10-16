// Image-only column preparation. No OCR text, vocabulary or reference is accepted.
export const COLUMN_PROFILES=['legacy','padding','seams','seam-padding','single-line','raw-line','seam-line','repaired'];
export function columnProfile(name,kind,orientation){
  if(!COLUMN_PROFILES.includes(name))throw new Error('未知分栏处理方式。');
  const effective=name==='repaired'?(kind==='paddle'&&orientation==='vertical'?'padding':'legacy'):name;
  const line=['single-line','raw-line','seam-line'].includes(effective)&&kind==='tesseract'&&orientation==='vertical';
  return {name,effective,padding:['legacy','seams'].includes(effective)?0:1,rotation:line?-90:0,psm:line?(effective==='raw-line'?'13':'7'):(orientation==='vertical'?'5':'6'),refine:['seams','seam-padding','seam-line'].includes(effective)&&orientation==='vertical'};
}

export function auditColumnBoxes(boxes,width,height){
  const rectangles=boxes.map(([x,y,w,h])=>[Math.round(x*width),Math.round(y*height),Math.round((x+w)*width),Math.round((y+h)*height)]).sort((a,b)=>a[0]-b[0]);
  let gaps=0,overlaps=0;for(let i=1;i<rectangles.length;i++){const delta=rectangles[i][0]-rectangles[i-1][2];gaps+=Math.max(0,delta);overlaps+=Math.max(0,-delta);}
  const fullCoverage=rectangles[0]?.[0]===0&&rectangles.at(-1)?.[2]===width&&rectangles.every(r=>r[1]===0&&r[3]===height)&&gaps===0&&overlaps===0;
  return {coordinateSystem:'original image pixels',rectangles,gapPixels:gaps,overlapPixels:overlaps,fullCoverage};
}

export function overlappingLines(items){
  const bounds=items.map(item=>{const xs=item.poly.map(p=>p[0]),ys=item.poly.map(p=>p[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];}),pairs=[];
  for(let i=0;i<bounds.length;i++)for(let j=i+1;j<bounds.length;j++){
    const a=bounds[i],b=bounds[j],intersection=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1])),union=(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-intersection;
    if(union>0&&intersection/union>.2)pairs.push({lineIndices:[i,j],IoU:intersection/union});
  }return pairs;
}

// Each seam moves within a small, disjoint neighbourhood to a lower-ink valley.
// All pixels remain owned by exactly one column. Ties keep the original seam.
export function refineCuts(density,cuts){
  if(cuts[0]!==0||cuts.at(-1)!==density.length||cuts.some((x,i)=>!Number.isInteger(x)||(i&&x<=cuts[i-1])))throw new Error('切线必须覆盖整图且严格递增。');
  const cost=x=>{let sum=0;for(let d=-1;d<=1;d++)sum+=density[Math.max(0,Math.min(density.length-1,x+d))];return sum/3;};
  return cuts.map((x,i)=>{
    if(!i||i===cuts.length-1)return x;
    const radius=Math.max(0,Math.floor(Math.min(x-cuts[i-1],cuts[i+1]-x)*.18));let best=x,bestCost=cost(x);
    for(let d=1;d<=radius;d++)for(const trial of [x-d,x+d]){const value=cost(trial);if(value<bestCost-.002){best=trial;bestCost=value;}}
    return best;
  });
}

export function refineColumnBoxes(image,boxes){
  const width=Math.min(2000,image.naturalWidth),height=Math.min(1200,image.naturalHeight),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('无法分析分栏边界。');
  try{
    ctx.drawImage(image,0,0,width,height);const {data}=ctx.getImageData(0,0,width,height),density=new Float64Array(width);
    const top=Math.floor(height*.08),bottom=Math.ceil(height*.92);
    for(let x=0;x<width;x++){let count=0;for(let y=top;y<bottom;y++){const i=(y*width+x)*4;if((data[i]+data[i+1]+data[i+2])/3<150)count++;}density[x]=count/(bottom-top);}
    const ascending=[...boxes].sort((a,b)=>a[0]-b[0]),cuts=[0,...ascending.slice(1).map(b=>Math.round(b[0]*width)),width];
    if(cuts.some((x,i)=>i&&x<=cuts[i-1]))return boxes;
    const refined=refineCuts(density,cuts),result=ascending.map((_,i)=>[refined[i]/width,0,(refined[i+1]-refined[i])/width,1]);
    return boxes[0][0]>boxes.at(-1)[0]?result.reverse():result;
  }finally{canvas.width=0;canvas.height=0;}
}

export function preparationGeometry(width,height,profile){
  const padding=Math.round(width*profile.padding),paddedWidth=width+2*padding,rotated=profile.rotation!==0;
  const w=rotated?height:paddedWidth,h=rotated?paddedWidth:height;
  const scale=Math.min(1,Math.sqrt(5_000_000/(w*h)),8000/Math.max(w,h));
  return {sourceSize:[width,height],paddingPixels:[padding,0,padding,0],rotationDegrees:profile.rotation,scale,workingSize:[Math.max(1,Math.round(w*scale)),Math.max(1,Math.round(h*scale))]};
}

export function prepareColumn(source,profile){
  const geometry=preparationGeometry(source.width,source.height,profile),canvas=document.createElement('canvas');[canvas.width,canvas.height]=geometry.workingSize;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('无法准备分栏图像。');
  try{
    ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.scale(geometry.scale,geometry.scale);
    const pad=geometry.paddingPixels[0];if(profile.rotation){ctx.translate(0,source.width+2*pad);ctx.rotate(-Math.PI/2);}
    ctx.drawImage(source,pad,0);return {canvas,geometry};
  }catch(error){canvas.width=0;canvas.height=0;throw error;}
}
