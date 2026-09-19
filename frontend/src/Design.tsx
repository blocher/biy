import {createElement, type ReactNode} from 'react'
import parse,{Element,attributesToProps} from 'html-react-parser'
export function Design({source,bindings,className}:{source:string;bindings:Record<string,ReactNode>;className:string}){
 return <div className={'design '+className}>{parse(source,{replace(node){if(node instanceof Element&&node.attribs.id&&Object.prototype.hasOwnProperty.call(bindings,node.attribs.id)){const content=bindings[node.attribs.id];if(content===null)return <></>;return createElement(node.name,attributesToProps(node.attribs),content)}}})}</div>
}
