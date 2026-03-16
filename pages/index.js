import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, generatePin, getQrUrl } from '../lib/supabase'
import Image from 'next/image'

// ─── Slide type icons & colors ───────────────────────────────────────────────
const SLIDE_META = {
  pdf:       { icon: '📄', label: 'PDF слайд',      color: '#5c8dfc' },
  poll:      { icon: '📊', label: 'Анкета',          color: '#7c5cfc' },
  wordcloud: { icon: '☁️', label: 'Облак от думи',   color: '#4ade80' },
  drawing:   { icon: '🎨', label: 'Рисуване',        color: '#f472b6' },
  freetext:  { icon: '✍️', label: 'Свободен отговор',color: '#fb923c' },
}

const WORD_COLORS = ['#7c5cfc','#5c8dfc','#f472b6','#fb923c','#4ade80','#fbbf24','#f87171','#a78bfa','#34d399','#60a5fa']

export default function TeacherPage() {
  const [session, setSession]       = useState(null)
  const [slides, setSlides]         = useState([])
  const [activeIdx, setActiveIdx]   = useState(0)
  const [students, setStudents]     = useState([])
  const [pollAnswers, setPollAnswers]     = useState([])
  const [wordSubs, setWordSubs]         = useState([])
  const [drawings, setDrawings]         = useState([])
  const [freetextSubs, setFreetextSubs] = useState([])
  const [loading, setLoading]       = useState(false)
  const [pdfPages, setPdfPages]     = useState([])   // data-urls of PDF pages
  const [sessionTitle, setSessionTitle] = useState('Биология - Клетката')
  const [newPollQuestion, setNewPollQuestion] = useState('')
  const [newPollChoices, setNewPollChoices]   = useState(['', '', '', ''])
  const [newFreeQuestion, setNewFreeQuestion] = useState('')
  const [newFreeKeywords, setNewFreeKeywords] = useState('')  // comma-separated
  const [tab, setTab] = useState('slides') // 'slides' | 'results' | 'session'
  const fileRef = useRef()

  // ── Create session ──────────────────────────────────────────────────────────
  async function createSession() {
    setLoading(true)
    const pin = generatePin()
    const teacherId = `teacher_${Date.now()}`
    localStorage.setItem('classflow_teacher_id', teacherId)

    const { data, error } = await supabase
      .from('sessions')
      .insert({ pin, title: sessionTitle, teacher_id: teacherId })
      .select().single()

    if (!error) {
      setSession(data)
      subscribeToSession(data.id)
    }
    setLoading(false)
  }

  // ── Realtime subscriptions ──────────────────────────────────────────────────
  function subscribeToSession(sessionId) {
    supabase.channel('session-' + sessionId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'students', filter: `session_id=eq.${sessionId}` },
        () => fetchStudents(sessionId))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'poll_answers', filter: `session_id=eq.${sessionId}` },
        () => fetchPollAnswers(sessionId))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'word_submissions', filter: `session_id=eq.${sessionId}` },
        () => fetchWords(sessionId))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'drawing_submissions', filter: `session_id=eq.${sessionId}` },
        () => fetchDrawings(sessionId))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'freetext_submissions', filter: `session_id=eq.${sessionId}` },
        () => fetchFreetext(sessionId))
      .subscribe()
  }

  async function fetchStudents(id) {
    const { data } = await supabase.from('students').select('*').eq('session_id', id)
    if (data) setStudents(data)
  }
  async function fetchPollAnswers(id) {
    const { data } = await supabase.from('poll_answers').select('*').eq('session_id', id)
    if (data) setPollAnswers(data)
  }
  async function fetchWords(id) {
    const { data } = await supabase.from('word_submissions').select('*').eq('session_id', id)
    if (data) setWordSubs(data)
  }
  async function fetchDrawings(id) {
    const { data } = await supabase.from('drawing_submissions').select('*').eq('session_id', id)
    if (data) setDrawings(data)
  }
  async function fetchFreetext(id) {
    const { data } = await supabase.from('freetext_submissions').select('*').eq('session_id', id)
    if (data) setFreetextSubs(data)
  }

  // ── PDF Upload ──────────────────────────────────────────────────────────────
  async function handlePdfUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setLoading(true)

    // Dynamically import pdfjs
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const pages = []

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 1.5 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
      pages.push(canvas.toDataURL('image/jpeg', 0.85))
    }

    setPdfPages(pages)

    // Create slides from PDF pages (if session exists)
    if (session) {
      const slideData = pages.map((_, i) => ({
        session_id: session.id,
        position: i,
        type: 'pdf',
        content: { page_index: i }
      }))
      const { data } = await supabase.from('slides').insert(slideData).select()
      if (data) setSlides(prev => [...data, ...prev.filter(s => s.type !== 'pdf')])
    } else {
      // Store pages locally before session is created
      setSlides(pages.map((_, i) => ({
        id: `local_${i}`,
        type: 'pdf',
        position: i,
        content: { page_index: i }
      })))
    }
    setLoading(false)
  }

  // ── Add interactive slides ──────────────────────────────────────────────────
  async function addPollSlide() {
    const choices = newPollChoices.filter(c => c.trim())
    if (!newPollQuestion.trim() || choices.length < 2) return alert('Въведи въпрос и поне 2 отговора')

    const slideData = {
      type: 'poll',
      position: slides.length,
      content: { question: newPollQuestion, choices }
    }
    if (session) {
      const { data } = await supabase.from('slides').insert({ ...slideData, session_id: session.id }).select().single()
      if (data) setSlides(prev => [...prev, data])
    } else {
      setSlides(prev => [...prev, { id: `local_poll_${Date.now()}`, ...slideData }])
    }
    setNewPollQuestion('')
    setNewPollChoices(['', '', '', ''])
  }

  async function addWordCloudSlide() {
    const slideData = { type: 'wordcloud', position: slides.length, content: { prompt: 'Напиши думи свързани с темата' } }
    if (session) {
      const { data } = await supabase.from('slides').insert({ ...slideData, session_id: session.id }).select().single()
      if (data) setSlides(prev => [...prev, data])
    } else {
      setSlides(prev => [...prev, { id: `local_wc_${Date.now()}`, ...slideData }])
    }
  }

  async function addDrawingSlide() {
    const slideData = { type: 'drawing', position: slides.length, content: { prompt: 'Нарисувай нещо свързано с темата' } }
    if (session) {
      const { data } = await supabase.from('slides').insert({ ...slideData, session_id: session.id }).select().single()
      if (data) setSlides(prev => [...prev, data])
    } else {
      setSlides(prev => [...prev, { id: `local_draw_${Date.now()}`, ...slideData }])
    }
  }

  async function addFreeTextSlide() {
    if (!newFreeQuestion.trim()) return alert('Въведи въпрос')
    // Parse keywords: split by comma, trim whitespace, filter empty
    const keywords = newFreeKeywords
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0)
    const slideData = {
      type: 'freetext',
      position: slides.length,
      content: { question: newFreeQuestion, keywords }
    }
    if (session) {
      const { data } = await supabase.from('slides').insert({ ...slideData, session_id: session.id }).select().single()
      if (data) setSlides(prev => [...prev, data])
    } else {
      setSlides(prev => [...prev, { id: `local_ft_${Date.now()}`, ...slideData }])
    }
    setNewFreeQuestion('')
    setNewFreeKeywords('')
  }

  // ── Navigate slides (broadcasts to students) ───────────────────────────────
  async function goToSlide(idx) {
    setActiveIdx(idx)
    if (session) {
      await supabase.from('sessions').update({ current_slide: idx }).eq('id', session.id)
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const activeSlide = slides[activeIdx]

  function getPollResults(slide) {
    const answers = pollAnswers.filter(a => a.slide_id === slide.id)
    return (slide.content.choices || []).map((choice, i) => ({
      label: choice,
      count: answers.filter(a => a.choice_index === i).length,
      color: WORD_COLORS[i % WORD_COLORS.length]
    }))
  }

  function getWordCounts(slide) {
    const words = wordSubs.filter(w => w.slide_id === slide.id)
    const counts = {}
    words.forEach(w => { counts[w.word] = (counts[w.word] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1])
  }

  function getDrawingsForSlide(slide) {
    return drawings.filter(d => d.slide_id === slide.id)
  }

  function getFreetextForSlide(slide) {
    return freetextSubs.filter(f => f.slide_id === slide.id)
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'Outfit,sans-serif' }}>

      {/* Top bar */}
      <div style={{ display:'flex', alignItems:'center', gap:'1rem', padding:'0.75rem 1.25rem', background:'var(--bg2)', borderBottom:'1px solid var(--border)' }}>
        <span style={{ fontSize:20 }}>🎓</span>
        <span style={{ fontWeight:700, fontSize:18, letterSpacing:'-0.5px' }}>ClassFlow</span>
        <span style={{ flex:1 }}></span>

        {session ? (
          <>
            <div style={{ display:'flex', alignItems:'center', gap:8, background:'rgba(124,92,252,0.15)', border:'1px solid rgba(124,92,252,0.3)', borderRadius:8, padding:'4px 14px', fontSize:14 }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--green)', display:'inline-block', animation:'pulse 2s infinite' }}></span>
              <b style={{ letterSpacing:4, color:'var(--accent)' }}>{session.pin}</b>
              <span style={{ color:'var(--text2)' }}>· {students.length} ученика</span>
            </div>
            <img src={getQrUrl(session.pin)} width={48} height={48} alt="QR" style={{ borderRadius:6 }} />
          </>
        ) : (
          <input
            value={sessionTitle}
            onChange={e => setSessionTitle(e.target.value)}
            style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:8, padding:'6px 12px', color:'var(--text)', fontFamily:'Outfit,sans-serif', fontSize:14, width:240 }}
            placeholder="Заглавие на урока"
          />
        )}

        {!session && (
          <button onClick={createSession} disabled={loading}
            style={{ padding:'8px 20px', background:'var(--accent)', border:'none', borderRadius:10, color:'white', fontWeight:600, cursor:'pointer', fontFamily:'Outfit,sans-serif', fontSize:14 }}>
            {loading ? '...' : '▶ Стартирай сесия'}
          </button>
        )}
      </div>

      {/* Tab row */}
      <div style={{ display:'flex', gap:'0.5rem', padding:'0.75rem 1.25rem', background:'var(--bg2)', borderBottom:'1px solid var(--border)' }}>
        {[['slides','📋 Слайдове'], ['results','📊 Резултати'], ['session','⚙️ Сесия']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding:'6px 16px', borderRadius:8, fontSize:13, fontWeight:500, border:'1px solid', cursor:'pointer', fontFamily:'Outfit,sans-serif',
              background: tab===id ? 'var(--accent)' : 'none',
              borderColor: tab===id ? 'var(--accent)' : 'var(--border)',
              color: tab===id ? 'white' : 'var(--text2)'
            }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'240px 1fr', minHeight:'calc(100vh - 100px)' }}>

        {/* Sidebar - slide list */}
        <div style={{ background:'var(--bg2)', borderRight:'1px solid var(--border)', padding:'1rem', display:'flex', flexDirection:'column', gap:'0.5rem', overflowY:'auto' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'var(--text2)', letterSpacing:'0.5px', textTransform:'uppercase', marginBottom:'0.25rem' }}>Слайдове ({slides.length})</div>

          {slides.map((slide, i) => {
            const meta = SLIDE_META[slide.type] || SLIDE_META.pdf
            return (
              <div key={slide.id} onClick={() => goToSlide(i)}
                style={{ background: activeIdx===i ? 'rgba(124,92,252,0.12)' : 'var(--bg3)', border:`1px solid ${activeIdx===i ? 'var(--accent)' : 'var(--border)'}`, borderRadius:10, padding:'0.6rem 0.75rem', cursor:'pointer', display:'flex', alignItems:'center', gap:'0.6rem', transition:'all 0.15s' }}>
                <span style={{ fontSize:16, flexShrink:0 }}>{meta.icon}</span>
                <div style={{ overflow:'hidden' }}>
                  <div style={{ fontSize:13, fontWeight:500, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{meta.label} {slide.type === 'pdf' ? `#${(slide.content?.page_index ?? i) + 1}` : ''}</div>
                  {slide.content?.question && <div style={{ fontSize:11, color:'var(--text2)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{slide.content.question}</div>}
                </div>
              </div>
            )
          })}

          <div style={{ borderTop:'1px solid var(--border)', paddingTop:'0.75rem', marginTop:'0.25rem' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--text2)', letterSpacing:'0.5px', textTransform:'uppercase', marginBottom:'0.5rem' }}>Добави слайд</div>

            <button onClick={() => fileRef.current.click()}
              style={addBtnStyle('#5c8dfc')}>📄 Качи PDF</button>
            <input ref={fileRef} type="file" accept=".pdf" onChange={handlePdfUpload} style={{ display:'none' }} />

            <button onClick={addWordCloudSlide} style={addBtnStyle('#4ade80')}>☁️ Облак от думи</button>
            <button onClick={addDrawingSlide} style={addBtnStyle('#f472b6')}>🎨 Рисуване</button>
          </div>
        </div>

        {/* Main content */}
        <div style={{ padding:'1.25rem', overflowY:'auto' }}>

          {/* ── Tab: Slides ── */}
          {tab === 'slides' && (
            <div>
              {/* Poll builder */}
              <div style={cardStyle}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text2)', marginBottom:'0.75rem', textTransform:'uppercase', letterSpacing:'0.5px' }}>📊 Добави анкета</div>
                <input value={newPollQuestion} onChange={e => setNewPollQuestion(e.target.value)}
                  placeholder="Въпрос на анкетата..." style={inputStyle} />
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem', marginTop:'0.5rem' }}>
                  {newPollChoices.map((c, i) => (
                    <input key={i} value={c} onChange={e => { const arr = [...newPollChoices]; arr[i] = e.target.value; setNewPollChoices(arr) }}
                      placeholder={`Отговор ${i+1}`} style={inputStyle} />
                  ))}
                </div>
                <button onClick={addPollSlide} style={{ ...addBtnStyle('#7c5cfc'), marginTop:'0.75rem', width:'100%' }}>+ Добави анкета</button>
              </div>

              {/* Free text builder */}
              <div style={cardStyle}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--text2)', marginBottom:'0.75rem', textTransform:'uppercase', letterSpacing:'0.5px' }}>✍️ Добави свободен отговор</div>
                <input value={newFreeQuestion} onChange={e => setNewFreeQuestion(e.target.value)}
                  placeholder="Въпрос за свободен отговор..." style={inputStyle} />
                <div style={{ marginTop:'0.5rem' }}>
                  <input value={newFreeKeywords} onChange={e => setNewFreeKeywords(e.target.value)}
                    placeholder="Ключови думи (разделени със запетая): енергия, АТФ, дишане"
                    style={inputStyle} />
                  <div style={{ fontSize:11, color:'var(--text2)', marginTop:'0.3rem', paddingLeft:2 }}>
                    💡 Отговорите ще се оценяват по колко от тези думи съдържат
                  </div>
                </div>
                <button onClick={addFreeTextSlide} style={{ ...addBtnStyle('#fb923c'), marginTop:'0.75rem', width:'100%' }}>+ Добави въпрос</button>
              </div>

              {/* Current slide preview */}
              {activeSlide && <SlidePreview slide={activeSlide} pdfPages={pdfPages} />}
            </div>
          )}

          {/* ── Tab: Results ── */}
          {tab === 'results' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'1.25rem' }}>
              {/* Stats row */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.75rem' }}>
                {[
                  { num: students.length, label: 'Ученика', color: 'var(--green)' },
                  { num: pollAnswers.length, label: 'Анкетни отговора', color: 'var(--accent)' },
                  { num: wordSubs.length, label: 'Изпратени думи', color: 'var(--accent2)' },
                  { num: drawings.length, label: 'Рисунки', color: 'var(--pink)' },
                ].map((s, i) => (
                  <div key={i} style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:12, padding:'0.75rem 1rem' }}>
                    <div style={{ fontSize:26, fontWeight:700, color:s.color }}>{s.num}</div>
                    <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {slides.filter(s => s.type === 'poll').map(slide => (
                <div key={slide.id} style={cardStyle}>
                  <div style={{ fontSize:11, fontWeight:600, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'0.5rem' }}>📊 Анкета</div>
                  <div style={{ fontSize:16, fontWeight:600, marginBottom:'1rem' }}>{slide.content.question}</div>
                  {getPollResults(slide).map((r, i) => {
                    const total = getPollResults(slide).reduce((a,b) => a+b.count, 0) || 1
                    const pct = Math.round((r.count / total) * 100)
                    return (
                      <div key={i} style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.6rem' }}>
                        <div style={{ width:130, fontSize:14, fontWeight:500, flexShrink:0 }}>{r.label}</div>
                        <div style={{ flex:1, height:32, background:'var(--bg3)', borderRadius:8, overflow:'hidden' }}>
                          <div style={{ height:'100%', width:`${pct}%`, background:r.color, display:'flex', alignItems:'center', paddingLeft:12, fontSize:13, fontWeight:600, color:'white', minWidth:36, transition:'width 1s ease' }}>{pct}%</div>
                        </div>
                        <div style={{ fontSize:13, color:'var(--text2)', width:30, textAlign:'right' }}>{r.count}</div>
                      </div>
                    )
                  })}
                </div>
              ))}

              {slides.filter(s => s.type === 'wordcloud').map(slide => {
                const words = getWordCounts(slide)
                const max = words[0]?.[1] || 1
                return (
                  <div key={slide.id} style={cardStyle}>
                    <div style={{ fontSize:11, fontWeight:600, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'0.75rem' }}>☁️ Облак от думи</div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:'0.5rem', background:'var(--bg3)', borderRadius:12, padding:'1rem', minHeight:80 }}>
                      {words.map(([word, count], i) => {
                        const size = 13 + Math.round((count/max) * 22)
                        const col = WORD_COLORS[i % WORD_COLORS.length]
                        return <span key={word} style={{ fontSize:size, fontWeight:600, background:`${col}22`, color:col, border:`1px solid ${col}44`, borderRadius:999, padding:'3px 12px', cursor:'default' }}>{word} <small style={{ opacity:0.6, fontSize:11 }}>{count}</small></span>
                      })}
                      {words.length === 0 && <span style={{ color:'var(--text2)', fontSize:14 }}>Изчакване на думи...</span>}
                    </div>
                  </div>
                )
              })}

              {slides.filter(s => s.type === 'drawing').map(slide => {
                const drs = getDrawingsForSlide(slide)
                return (
                  <div key={slide.id} style={cardStyle}>
                    <div style={{ fontSize:11, fontWeight:600, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'0.75rem' }}>🎨 Рисунки ({drs.length})</div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:'0.75rem' }}>
                      {drs.map(d => (
                        <div key={d.id} style={{ background:'var(--bg3)', borderRadius:12, overflow:'hidden', border:'1px solid var(--border)' }}>
                          <img src={d.image_data} alt={d.student_name} style={{ width:'100%', aspectRatio:'4/3', objectFit:'cover' }} />
                          <div style={{ padding:'6px 10px', fontSize:12, color:'var(--text2)' }}>{d.student_name}</div>
                        </div>
                      ))}
                      {drs.length === 0 && <span style={{ color:'var(--text2)', fontSize:14 }}>Изчакване на рисунки...</span>}
                    </div>
                  </div>
                )
              })}

              {slides.filter(s => s.type === 'freetext').map(slide => {
                const answers = getFreetextForSlide(slide)
                const keywords = slide.content.keywords || []
                return (
                  <div key={slide.id} style={cardStyle}>
                    <div style={{ fontSize:11, fontWeight:600, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'0.5rem' }}>✍️ Свободни отговори</div>
                    <div style={{ fontSize:16, fontWeight:600, marginBottom:'0.5rem' }}>{slide.content.question}</div>
                    {keywords.length > 0 && (
                      <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:'1rem', alignItems:'center' }}>
                        <span style={{ fontSize:11, color:'var(--text2)', marginRight:4 }}>Ключови думи:</span>
                        {keywords.map(kw => (
                          <span key={kw} style={{ fontSize:12, fontWeight:500, background:'rgba(251,146,60,0.15)', color:'var(--orange)', border:'1px solid rgba(251,146,60,0.3)', borderRadius:999, padding:'2px 10px' }}>{kw}</span>
                        ))}
                      </div>
                    )}
                    {answers.map(a => {
                      const score = a.ai_score
                      const scoreColor = score >= 70 ? 'var(--green)' : score >= 40 ? 'var(--yellow)' : 'var(--red)'
                      return (
                        <div key={a.id} style={{ background:'var(--bg3)', borderRadius:10, padding:'0.75rem 1rem', marginBottom:'0.5rem', display:'flex', gap:'1rem', alignItems:'flex-start' }}>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:'0.25rem' }}>{a.student_name}</div>
                            <div style={{ fontSize:14, marginBottom: a.ai_feedback ? '0.4rem' : 0 }}>{a.answer}</div>
                            {a.ai_feedback && <div style={{ fontSize:12, color:'var(--text2)', fontStyle:'italic' }}>{a.ai_feedback}</div>}
                          </div>
                          {score != null && (
                            <div style={{ flexShrink:0, textAlign:'center', minWidth:52 }}>
                              <div style={{ fontSize:22, fontWeight:700, color: scoreColor }}>{score}<span style={{ fontSize:12 }}>%</span></div>
                              <div style={{ fontSize:10, color:'var(--text2)', marginTop:2 }}>съвпадение</div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {answers.length === 0 && <span style={{ color:'var(--text2)', fontSize:14 }}>Изчакване на отговори...</span>}
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Tab: Session info ── */}
          {tab === 'session' && (
            <div style={{ maxWidth:500 }}>
              {session ? (
                <div style={cardStyle}>
                  <div style={{ fontSize:16, fontWeight:600, marginBottom:'1.25rem' }}>Информация за сесията</div>
                  <div style={{ display:'flex', gap:'1.5rem', alignItems:'flex-start', marginBottom:'1.5rem' }}>
                    <img src={getQrUrl(session.pin)} width={160} height={160} alt="QR" style={{ borderRadius:12 }} />
                    <div>
                      <div style={{ fontSize:13, color:'var(--text2)', marginBottom:'0.25rem' }}>PIN код</div>
                      <div style={{ fontSize:48, fontWeight:700, letterSpacing:8, color:'var(--accent)', marginBottom:'0.5rem' }}>{session.pin}</div>
                      <div style={{ fontSize:13, color:'var(--text2)' }}>Учениците влизат на:</div>
                      <div style={{ fontSize:13, color:'var(--accent2)', marginTop:2 }}>{typeof window !== 'undefined' ? window.location.origin : ''}/join/{session.pin}</div>
                    </div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                    <div style={{ background:'var(--bg3)', borderRadius:10, padding:'0.75rem' }}>
                      <div style={{ fontSize:22, fontWeight:700, color:'var(--green)' }}>{students.length}</div>
                      <div style={{ fontSize:12, color:'var(--text2)' }}>Ученика онлайн</div>
                    </div>
                    <div style={{ background:'var(--bg3)', borderRadius:10, padding:'0.75rem' }}>
                      <div style={{ fontSize:22, fontWeight:700, color:'var(--accent)' }}>{slides.length}</div>
                      <div style={{ fontSize:12, color:'var(--text2)' }}>Слайда</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={cardStyle}>
                  <p style={{ color:'var(--text2)', fontSize:14 }}>Стартирай сесия, за да видиш информацията.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  )
}

function SlidePreview({ slide, pdfPages }) {
  const meta = SLIDE_META[slide.type] || SLIDE_META.pdf
  return (
    <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden', marginTop:'1.25rem' }}>
      <div style={{ padding:'0.75rem 1rem', borderBottom:'1px solid var(--border)', fontSize:13, fontWeight:600, color:'var(--text2)', textTransform:'uppercase', letterSpacing:'0.5px' }}>
        {meta.icon} Преглед на слайда
      </div>
      {slide.type === 'pdf' && pdfPages[slide.content?.page_index] && (
        <img src={pdfPages[slide.content.page_index]} alt={`Слайд ${slide.content.page_index + 1}`} style={{ width:'100%', display:'block' }} />
      )}
      {slide.type === 'poll' && (
        <div style={{ padding:'1.5rem' }}>
          <div style={{ fontSize:18, fontWeight:600, marginBottom:'1rem' }}>{slide.content.question}</div>
          {(slide.content.choices || []).map((c, i) => (
            <div key={i} style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:10, padding:'0.6rem 1rem', marginBottom:'0.5rem', fontSize:14 }}>
              <span style={{ color:'var(--accent)', fontWeight:600, marginRight:8 }}>{String.fromCharCode(1040+i)}.</span>{c}
            </div>
          ))}
        </div>
      )}
      {slide.type === 'wordcloud' && (
        <div style={{ padding:'1.5rem', textAlign:'center', color:'var(--text2)', fontSize:14 }}>☁️ Учениците ще изпращат думи — ще се появи облак</div>
      )}
      {slide.type === 'drawing' && (
        <div style={{ padding:'1.5rem', textAlign:'center', color:'var(--text2)', fontSize:14 }}>🎨 Учениците ще рисуват — рисунките ще се появят в резултатите</div>
      )}
      {slide.type === 'freetext' && (
        <div style={{ padding:'1.5rem' }}>
          <div style={{ fontSize:18, fontWeight:600 }}>{slide.content.question}</div>
          <div style={{ fontSize:13, color:'var(--text2)', marginTop:'0.5rem' }}>✍️ Свободен отговор с AI оценяване</div>
        </div>
      )}
    </div>
  )
}

const cardStyle = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  padding: '1.25rem',
  marginBottom: '1rem',
}

const inputStyle = {
  width: '100%',
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '0.6rem 0.875rem',
  color: 'var(--text)',
  fontFamily: 'Outfit,sans-serif',
  fontSize: 14,
  outline: 'none',
}

function addBtnStyle(color) {
  return {
    width: '100%',
    padding: '7px 12px',
    background: `${color}18`,
    border: `1px solid ${color}44`,
    borderRadius: 8,
    color: color,
    fontFamily: 'Outfit,sans-serif',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    marginBottom: '0.4rem',
    textAlign: 'left',
  }
}
