/** Keep the provider's surviving order and append newly available visits exactly once. */
export function reconcileServiceDayOrder(order:readonly string[],visits:readonly {id:string}[]):string[]{const available=new Set(visits.map(v=>v.id));const result:string[]=[];for(const id of [...order,...visits.map(v=>v.id)])if(available.delete(id))result.push(id);return result;}
