const levels={high:{label:'高优先级',mark:'!!!',rank:3},medium:{label:'中优先级',mark:'!!',rank:2},low:{label:'低优先级',mark:'!',rank:1},none:{label:'无优先级',mark:'',rank:0}};

/** 只展示已确认的固定优先级；未知不降为无优先级。 */
export function priorityInfo(value) {
  return Object.hasOwn(levels,value) ? levels[value] : {label:'优先级不可读',mark:'',rank:null};
}
