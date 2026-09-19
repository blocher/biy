let csrf=''
export function setCSRF(value:string){csrf=value}
export async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
  const response=await fetch('/api'+path,{method,credentials:'same-origin',headers:{'Content-Type':'application/json',...(method==='GET'?{}:{'X-CSRFToken':csrf})},body:body===undefined?undefined:JSON.stringify(body)})
  let data;try{data=await response.json()}catch{throw new Error('The server could not complete this request. Please try again.')}
  if(!response.ok){if(response.status===401&&path!=='/login')window.dispatchEvent(new Event('session-expired'));throw new Error(typeof data.detail==='string'?data.detail:'Could not save this change. Please try again.')}
  return data as T
}
export const time=(seconds:number)=>`${Math.floor(seconds/60)}:${Math.floor(seconds%60).toString().padStart(2,'0')}`
export const date=(value:string)=>new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})
export const episodeTitle=(title:string)=>title.replace(/^Day\s+\d+:\s*/i,'').replace(/\s*[-–]?\s*\(?2025\)?$/,'')
