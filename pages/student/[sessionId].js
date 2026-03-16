import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'

const WORD_COLORS = ['#7c5cfc','#5c8dfc','#f472b6','#fb923c','#4ade80','#fbbf24','#f87171','#a78bfa']

export default function StudentSession() {
  const router = useRouter()
  const { sessionId } = router.query

  const [session, setSession] = useState(null)
  const [slides, setSlides] = useState([])
  const [currentSlideIdx, setCurrentSlideIdx] = useState(0)
  const [studentId, setStudentId] = useState(null)
  const [studentName, setStudentName] = useState('')
  const [answered, setAnswered] = useState({}) // slideId -> true
  const [wordInput, setWordInput] = useState('')
  const [submittedWords, setSubmittedWords] = useState([])
  const [freeInput, setFreeInput] = useState('')
  const [freeSubmitted, setFreeSubmitted] = useState({})
  const [drawColor, setDrawColor] = useState('#1e1e1e')
  const [brushSize, setBrushSize] = useState(5)
  const [drawingSubmitted, setDrawingSubmitted] = useState({})
  const canvasRef = useRef()
  const isDrawing = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (!sessionId) return
    const sid = localStorage.getItem('classflow_student_id')
    const sname = localStorage.getItem('classflow_student_name')
    if (!sid) { router.push('/'); return }
    setStudentId(sid)
    setStudentName(sname || 'Ученик')
    loadSession()
    subscribeToSession()
  }, [sessionId])

  async function loadSession() {
    const { data: sess } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
    if (sess) {
      setSession(sess)
      setCurrentSlideIdx(sess.current_slide || 0)
    }
    const { data: sl } = await supabase.from('slides').select('*').eq('session_id', sessionId).order('position')
    if (sl) setSlides(sl)
  }

  function subscribeToSession() {
    supabase.channel('student-' + sessionId)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          setCurrentSlideIdx(payload.new.current_slide || 0)
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'slides', filter: `session_id=eq.${sessionId}` },
        () => loadSession())
      .subscribe()
  }

  const currentSlide = slides[currentSlideIdx]

  // ── Canvas drawing ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (currentSlide?.type !== 'drawing') return
    setTimeout(() => initCanvas(), 200)
  }, [currentSlide])

  function initCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const container = canvas.parentElement
    canvas.width = container.offsetWidth
    canvas.height = Math.round(container.offsetWidth * 9/16)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
  }

  function startDraw(e) {
    e.preventDefault()
    isDrawing.current = true
    const pos = getPos(e, canvasRef.current)
    lastPos.current = pos
  }

  function draw(e) {
    e.preventDefault()
    if (!isDrawing.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e, canvas)
    ctx.strokeStyle = drawColor
    ctx.lineWidth = brushSize
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    lastPos.current = pos
  }

  function stopDraw() { isDrawing.current = false }

  function clearCanvas() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  // ── Submit handlers ─────────────────────────────────────────────────────────
  async function submitPoll(choiceIndex) {
    if (!currentSlide || answered[currentSlide.id]) return
    await supabase.from('poll_answers').insert({
      session_id: sessionId,
      slide_id: currentSlide.id,
      student_id: studentId,
      choice_index: choiceIndex,
    })
    setAnswered(prev => ({ ...prev, [currentSlide.id]: choiceIndex }))
  }

  async function submitWord() {
    const word = wordInput.trim()
    if (!word || !currentSlide) return
    await supabase.from('word_submissions').insert({
      session_id: sessionId,
      slide_id: currentSlide.id,
      student_id: studentId,
      word,
    })
    setSubmittedWords(prev => [...prev, word])
    setWordInput('')
  }

  async function submitDrawing() {
    const canvas = canvasRef.current
    if (!canvas || !currentSlide) return
    const imageData = canvas.toDataURL('image/jpeg', 0.7)
    await supabase.from('drawing_submissions').insert({
      session_id: sessionId,
      slide_id: currentSlide.id,
      student_id: studentId,
      student_name: studentName,
      image_data: imageData,
    })
    setDrawingSubmitted(prev => ({ ...prev, [currentSlide.id]: true }))
    alert('✓ Рисунката е изпратена!')
  }

  async function submitFreetext() {
    const answer = freeInput.trim()
    if (!answer || !currentSlide) return

    const { data } = await supabase.from('freetext_submissions').insert({
      session_id: sessionId,
      slide_id: currentSlide.id,
      student_id: studentId,
      student_name: studentName,
      answer,
    }).select().single()

    setFreeInput('')

    // Keyword-based grading — fast, free, no API needed
    const keywords = currentSlide.content.keywords || []
    let score = null
    let feedback = 'Отговорът е получен!'

    if (keywords.length > 0 && data) {
      try {
        const res = await fetch('/api/grade-answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer, keywords })
        })
        const result = await res.json()
        score = result.score
        feedback = result.feedback

        await supabase.from('freetext_submissions').update({
          ai_score: result.score,
          ai_feedback: result.feedback,
        }).eq('id', data.id)
      } catch {}
    }

    setFreeSubmitted(prev => ({ ...prev, [currentSlide.id]: { score, feedback } }))
  }

  if (!currentSlide) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Outfit,sans-serif', color:'var(--text)' }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:'1rem' }}>⏳</div>
          <div style={{ fontSize:18, fontWeight:600, marginBottom:'0.5rem' }}>Зареждане...</div>
          <div style={{ fontSize:14, color:'var(--text2)' }}>Изчакай учителя да стартира урока</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', color:'var(--text)', fontFamily:'Outfit,sans-serif' }}>
      {/* Top bar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.75rem 1.25rem', background:'rgba(255,255,255,0.03)', borderBottom:'1px solid var(--border)' }}>
        <span style={{ fontSize:16, fontWeight:700 }}>🎓 {session?.title || 'Урок'}</span>
        <div style={{ background:'rgba(124,92,252,0.2)', border:'1px solid rgba(124,92,252,0.3)', borderRadius:8, padding:'4px 12px', fontSize:13, fontWeight:500 }}>{studentName}</div>
      </div>

      {/* Slide indicator */}
      <div style={{ padding:'0.5rem 1.25rem', display:'flex', gap:4, overflowX:'auto' }}>
        {slides.map((_, i) => (
          <div key={i} style={{ width:24, height:4, borderRadius:2, background: i === currentSlideIdx ? 'var(--accent)' : 'var(--border)', flexShrink:0, transition:'background 0.3s' }} />
        ))}
      </div>

      <div style={{ padding:'1.25rem', maxWidth:600, margin:'0 auto' }}>

        {/* PDF slide */}
        {currentSlide.type === 'pdf' && (
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:12, color:'var(--text2)', marginBottom:'0.5rem', textTransform:'uppercase', letterSpacing:'0.5px' }}>Слайд {currentSlideIdx + 1} / {slides.length}</div>
            <div style={{ background:'var(--bg2)', borderRadius:12, overflow:'hidden', border:'1px solid var(--border)' }}>
              <div style={{ padding:'3rem', color:'var(--text2)', fontSize:14 }}>📄 PDF слайд #{(currentSlide.content?.page_index ?? currentSlideIdx) + 1}</div>
            </div>
          </div>
        )}

        {/* Poll */}
        {currentSlide.type === 'poll' && (
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:20, padding:'1.5rem' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--accent)', letterSpacing:1, textTransform:'uppercase', marginBottom:'0.5rem' }}>📊 Анкета</div>
            <div style={{ fontSize:18, fontWeight:600, lineHeight:1.4, marginBottom:'1.25rem' }}>{currentSlide.content.question}</div>
            {(currentSlide.content.choices || []).map((choice, i) => {
              const isSelected = answered[currentSlide.id] === i
              const isAnswered = answered[currentSlide.id] !== undefined
              return (
                <button key={i} onClick={() => submitPoll(i)} disabled={isAnswered}
                  style={{ width:'100%', textAlign:'left', padding:'0.75rem 1rem', background: isSelected ? 'rgba(124,92,252,0.15)' : 'var(--bg3)', border:`1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`, borderRadius:12, color:'var(--text)', fontSize:15, fontFamily:'Outfit,sans-serif', cursor: isAnswered ? 'not-allowed' : 'pointer', marginBottom:'0.5rem', display:'flex', alignItems:'center', gap:'0.75rem', transition:'all 0.15s' }}>
                  <span style={{ width:28, height:28, borderRadius:'50%', background: isSelected ? 'var(--accent)' : 'var(--surface)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, flexShrink:0, color:'white' }}>
                    {String.fromCharCode(1040+i)}
                  </span>
                  {choice}
                </button>
              )
            })}
            {answered[currentSlide.id] !== undefined && (
              <div style={{ textAlign:'center', padding:'1rem', color:'var(--green)', fontSize:15, fontWeight:500 }}>✓ Отговорът е изпратен!</div>
            )}
          </div>
        )}

        {/* Word Cloud */}
        {currentSlide.type === 'wordcloud' && (
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:20, padding:'1.5rem' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--green)', letterSpacing:1, textTransform:'uppercase', marginBottom:'0.5rem' }}>☁️ Облак от думи</div>
            <div style={{ fontSize:18, fontWeight:600, lineHeight:1.4, marginBottom:'1.25rem' }}>{currentSlide.content.prompt || 'Напиши думи свързани с темата'}</div>
            <div style={{ display:'flex', gap:'0.75rem' }}>
              <input value={wordInput} onChange={e => setWordInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitWord()}
                placeholder="Напиши дума..."
                maxLength={30}
                style={{ flex:1, background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:12, padding:'0.75rem 1rem', color:'var(--text)', fontFamily:'Outfit,sans-serif', fontSize:15, outline:'none' }}
              />
              <button onClick={submitWord}
                style={{ padding:'0.75rem 1.25rem', background:'var(--accent)', border:'none', borderRadius:12, color:'white', fontSize:15, fontWeight:600, fontFamily:'Outfit,sans-serif', cursor:'pointer' }}>→</button>
            </div>
            {submittedWords.length > 0 && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:'0.4rem', marginTop:'0.75rem' }}>
                {submittedWords.map((w, i) => {
                  const col = WORD_COLORS[i % WORD_COLORS.length]
                  return <span key={i} style={{ padding:'3px 10px', borderRadius:999, fontSize:13, fontWeight:500, background:`${col}22`, color:col, border:`1px solid ${col}44` }}>{w}</span>
                })}
              </div>
            )}
          </div>
        )}

        {/* Drawing */}
        {currentSlide.type === 'drawing' && (
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:20, padding:'1.5rem' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--pink)', letterSpacing:1, textTransform:'uppercase', marginBottom:'0.5rem' }}>🎨 Рисуване</div>
            <div style={{ fontSize:18, fontWeight:600, lineHeight:1.4, marginBottom:'1rem' }}>{currentSlide.content.prompt || 'Нарисувай нещо свързано с темата'}</div>
            <div style={{ background:'white', borderRadius:12, overflow:'hidden', touchAction:'none' }}>
              <canvas
                ref={canvasRef}
                style={{ width:'100%', display:'block', cursor:'crosshair' }}
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
              />
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap', marginTop:'0.75rem' }}>
              {['#1e1e1e','#7c5cfc','#f472b6','#4ade80','#fbbf24','#f87171','#5c8dfc','#fb923c'].map(col => (
                <div key={col} onClick={() => setDrawColor(col)}
                  style={{ width:28, height:28, borderRadius:'50%', background:col, cursor:'pointer', border:`3px solid ${drawColor===col ? 'white' : 'transparent'}`, flexShrink:0, transition:'transform 0.15s', transform: drawColor===col ? 'scale(1.2)' : 'scale(1)' }} />
              ))}
              <input type="range" min={2} max={20} value={brushSize} onChange={e => setBrushSize(Number(e.target.value))}
                style={{ flex:1, minWidth:80, accentColor:'var(--accent)' }} />
              <button onClick={clearCanvas}
                style={{ padding:'6px 14px', background:'none', border:'1px solid var(--border)', borderRadius:8, color:'var(--text2)', fontFamily:'Outfit,sans-serif', fontSize:13, cursor:'pointer' }}>Изчисти</button>
              <button onClick={submitDrawing} disabled={drawingSubmitted[currentSlide.id]}
                style={{ padding:'6px 14px', background: drawingSubmitted[currentSlide.id] ? 'var(--surface)' : 'var(--accent)', border:'none', borderRadius:8, color:'white', fontFamily:'Outfit,sans-serif', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                {drawingSubmitted[currentSlide.id] ? '✓ Изпратено' : 'Изпрати'}
              </button>
            </div>
          </div>
        )}

        {/* Free text */}
        {currentSlide.type === 'freetext' && (
          <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:20, padding:'1.5rem' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'var(--orange)', letterSpacing:1, textTransform:'uppercase', marginBottom:'0.5rem' }}>✍️ Свободен отговор</div>
            <div style={{ fontSize:18, fontWeight:600, lineHeight:1.4, marginBottom:'1.25rem' }}>{currentSlide.content.question}</div>
            {freeSubmitted[currentSlide.id] ? (
              <div style={{ textAlign:'center', padding:'1rem' }}>
                {(() => {
                  const result = freeSubmitted[currentSlide.id]
                  const score = result?.score
                  const feedback = result?.feedback
                  const scoreColor = score >= 70 ? 'var(--green)' : score >= 40 ? 'var(--yellow)' : 'var(--red)'
                  return (
                    <>
                      <div style={{ fontSize:15, fontWeight:500, color:'var(--green)', marginBottom:'0.75rem' }}>✓ Отговорът е изпратен!</div>
                      {score != null && (
                        <div style={{ background:'var(--bg3)', borderRadius:14, padding:'1rem' }}>
                          <div style={{ fontSize:42, fontWeight:700, color: scoreColor, lineHeight:1 }}>{score}<span style={{ fontSize:18 }}>%</span></div>
                          <div style={{ fontSize:12, color:'var(--text2)', margin:'4px 0 8px' }}>съвпадение с ключовите думи</div>
                          {feedback && <div style={{ fontSize:13, color:'var(--text)', lineHeight:1.5 }}>{feedback}</div>}
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            ) : (
              <>
                <textarea value={freeInput} onChange={e => setFreeInput(e.target.value)}
                  placeholder="Напиши отговора си тук..."
                  rows={4}
                  style={{ width:'100%', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:12, padding:'0.75rem 1rem', color:'var(--text)', fontFamily:'Outfit,sans-serif', fontSize:15, outline:'none', resize:'vertical' }}
                />
                <button onClick={submitFreetext}
                  style={{ marginTop:'0.75rem', width:'100%', padding:'0.85rem', background:'var(--accent)', border:'none', borderRadius:12, color:'white', fontSize:15, fontWeight:600, fontFamily:'Outfit,sans-serif', cursor:'pointer' }}>
                  Изпрати отговора →
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
