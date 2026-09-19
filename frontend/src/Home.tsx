import {Link} from 'react-router-dom'
import {ArrowRight,NotebookPen,Headphones,CheckCircle2} from 'lucide-react'
import {Design} from './Design'
import source from './design/home.html?raw'
import type {Library} from './types'
import {Sidebar} from './navigation'
import {DayTable,Timeline} from './Library'
import {episodeTitle} from './api'
export function Home({user,library,onChange,onError}:{user:string;library:Library;onChange:()=>void;onError:(e:string)=>void}){
 const next=library.days.find(d=>d.number===library.next_day),percent=Math.round(library.completed/365*100)
 return <Design source={source} className="home-design" bindings={{
 'mobile-390-page-flow':null,
 'sidebar':<Sidebar user={user} embedded/>,
 'header':<><span className="eyebrow">YOUR DAILY COMPANION</span><span className="greeting">Welcome back, {user} <span className="avatar">{user[0].toUpperCase()}</span></span></>,
 'hero-eyebrow':null,
 'hero-headline':<h1>A little each day.<br/><em>A story that changes everything.</em></h1>,
 'hero-day-label':<span className="eyebrow" style={{color:next?.color||'#123f34'}}>{next?`${next.era} · DAY ${next.number}`:'365 DAYS · ONE BEAUTIFUL JOURNEY'}</span>,
 'hero-title':<h2>{next?(next.episode?episodeTitle(next.episode.title):next.readings[0]):'You’ve read the whole story.'}</h2>,
 'hero-reference':<p>{next?.readings.join(' · ')||'Your notes and every reading are here whenever you want to return.'}</p>,
 'hero-continue':next?<><Link className="primary continue-button" to={`/day/${next.number}`}>Continue Day {next.number}<ArrowRight size={21}/></Link><span className="quiet">Your next unread day</span></>:<Link className="primary" to="/plan"><CheckCircle2 size={20}/> Revisit your year</Link>,
 'hero-progress':<div className="progress-panel"><div><strong>{library.completed}</strong> of 365 days complete <span>{percent}%</span></div><progress value={library.completed} max={365} aria-label="Year completion"/><p className="quiet">Every day is a new beginning.</p></div>,
 'hero-quote':null,
 'reading-rhythm':<DayTable library={library} onChange={onChange} onError={onError} compact/>,
 'reflection':<><span className="eyebrow">PAUSE & REFLECT</span><h2>What is staying<br/>with you today?</h2><p>A thought, a question, a moment of grace.<br/>Make a little space to notice.</p><Link className="text-link" to="/journal"><NotebookPen size={18}/> Open your journal <ArrowRight size={16}/></Link></>,
 'listen':<><span className="eyebrow">BEYOND THE DAILY READING</span><h2>Listen a little deeper.</h2><p>Explore the introductions and conversations that help the bigger story come into focus.</p><Link className="text-link" to="/extras"><Headphones size={18}/> Extra episodes <ArrowRight size={16}/></Link></>,
 'eras':<Timeline library={library}/>,
 }}/>
}
