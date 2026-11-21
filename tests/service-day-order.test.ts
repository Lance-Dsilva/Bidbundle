import {expect,it} from 'vitest';
import {reconcileServiceDayOrder} from '@/lib/service-day-order';
it('replaces a cancelled historical stop with a new resumed visit without losing custom order',()=>{expect(reconcileServiceDayOrder(['b','old-cancelled','a'],[{id:'a'},{id:'resumed'},{id:'b'}])).toEqual(['b','a','resumed']);});
it('publishes each current visit once despite stale and duplicate prior ids',()=>{const ids=reconcileServiceDayOrder(['gone','b','b'],[{id:'a'},{id:'b'},{id:'c'}]);expect(ids.map((visitId,index)=>({visitId,stopRank:index+1}))).toEqual([{visitId:'b',stopRank:1},{visitId:'a',stopRank:2},{visitId:'c',stopRank:3}]);});
it('keeps a reordered new visit stable on the next refresh',()=>{expect(reconcileServiceDayOrder(['new','b','a'],[{id:'a'},{id:'b'},{id:'new'}])).toEqual(['new','b','a']);});
