// Same geometry-only rule as the frozen browser experiment. No reference text.
export function sortItems(items, orientation = 'vertical') {
  const boxes=items.map((item,index)=>{const xs=item.poly.map(p=>p[0]),ys=item.poly.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;return {index,x,y,w,h,item};});
  boxes.sort((a,b)=>orientation==='vertical'?(b.x+b.w/2)-(a.x+a.w/2)||a.y-b.y:a.y-b.y||a.x-b.x);
  const groups=[];
  for(const box of boxes){const center=orientation==='vertical'?box.x+box.w/2:box.y+box.h/2,extent=orientation==='vertical'?box.w:box.h;
    let group=groups.find(g=>Math.abs(g.center-center)<=.6*Math.min(g.extent,extent));
    if(!group){group={center,extent,boxes:[]};groups.push(group);}group.boxes.push(box);
  }
  return groups.flatMap(g=>g.boxes.sort((a,b)=>orientation==='vertical'?a.y-b.y:a.x-b.x)).map(b=>b.item);
}
