import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'

export default function JoinPage() {
  const router = useRouter()
  const { pin: urlPin } = router.query
  const [pin, setPin] = useState(urlPin || '')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleJoin() {
    const cleanPin = pin.trim().toUpperCase()
    const cleanName = name.trim()
    if (!cleanPin || !cleanName) return setError('Въведи PIN и твоето име')

    setLoading(true)
    setError('')

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('pin', cleanPin)
      .eq('is_active', true)
      .single()

    if (sessionError || !session) {
      setError('Невалиден PIN код. Провери отново.')
      setLoading(false)
      return
    }

    const { data: student, error: studentError } = await supabase
      .from('students')
      .insert({ session_id: session.id, name: cleanName })
      .select().single()

    if (studentError) {
      setError('Грешка при влизане. Опитай пак.')
      setLoading(false)
      return
    }

    localStorage.setItem('classflow_student_id', student.id)
    localStorage.setItem('classflow_student_name', cleanName)
    router.push(`/student/${session.id}`)
  }

  return (
    <div style={{ minHeight:'100vh', background:'radial-gradient(ellipse at 50% 0%, #1e1050 0%, transparent 60%), var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:'2rem', fontFamily:'Outfit,sans-serif' }}>
      <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:20, padding:'2.5rem', width:'100%', maxWidth:360, textAlign:'center' }}>
        <div style={{ fontSize:44, marginBottom:'1rem' }}>🎒</div>
        <h1 style={{ fontSize:24, fontWeight:700, marginBottom:'0.5rem' }}>Влез в стаята</h1>
        <p style={{ fontSize:14, color:'var(--text2)', marginBottom:'2rem' }}>Въведи PIN кода от учителя</p>

        <input
          value={pin}
          onChange={e => setPin(e.target.value.toUpperCase())}
          placeholder="XXXXX"
          maxLength={6}
          onKeyDown={e => e.key === 'Enter' && handleJoin()}
          style={{ width:'100%', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:12, padding:'0.85rem 1rem', color:'var(--text)', fontFamily:'Outfit,sans-serif', fontSize:22, textAlign:'center', letterSpacing:6, fontWeight:600, marginBottom:'0.75rem', outline:'none' }}
        />

        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Твоето име"
          onKeyDown={e => e.key === 'Enter' && handleJoin()}
          style={{ width:'100%', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:12, padding:'0.75rem 1rem', color:'var(--text)', fontFamily:'Outfit,sans-serif', fontSize:15, textAlign:'center', marginBottom:'0.75rem', outline:'none' }}
        />

        {error && <div style={{ color:'var(--red)', fontSize:13, marginBottom:'0.75rem' }}>{error}</div>}

        <button onClick={handleJoin} disabled={loading}
          style={{ width:'100%', padding:'0.85rem', background:'var(--accent)', border:'none', borderRadius:12, color:'white', fontSize:16, fontWeight:600, fontFamily:'Outfit,sans-serif', cursor:'pointer' }}>
          {loading ? 'Зареждане...' : 'Влез →'}
        </button>
      </div>
    </div>
  )
}
