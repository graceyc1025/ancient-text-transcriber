// 有逐字真值时才能统计错识/漏识/多识；不将引擎检测数量当原图字数。
export function editOperations(reference,observed){
  const a=Array.from(reference),b=Array.from(observed),rows=Array.from({length:a.length+1},()=>new Uint32Array(b.length+1));
  for(let i=0;i<=a.length;i++)rows[i][0]=i;for(let j=0;j<=b.length;j++)rows[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)rows[i][j]=Math.min(rows[i-1][j]+1,rows[i][j-1]+1,rows[i-1][j-1]+Number(a[i-1]!==b[j-1]));
  let i=a.length,j=b.length,substitutions=0,deletions=0,insertions=0;
  while(i||j){if(i&&j&&rows[i][j]===rows[i-1][j-1]+Number(a[i-1]!==b[j-1])){substitutions+=Number(a[i-1]!==b[j-1]);i--;j--;}
    else if(i&&rows[i][j]===rows[i-1][j]+1){deletions++;i--;}else{insertions++;j--;}}
  return {substitutions,deletions,insertions,distance:rows[a.length][b.length],referenceCharacters:a.length,CER:a.length?rows[a.length][b.length]/a.length:null};
}
export function orderInversions(sequence){const collapsed=sequence.filter((value,i)=>i===0||value!==sequence[i-1]);let inversions=0;for(let i=0;i<collapsed.length;i++)for(let j=i+1;j<collapsed.length;j++)if(collapsed[i]>collapsed[j])inversions++;return inversions;}
