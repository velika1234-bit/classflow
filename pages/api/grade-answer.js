// pages/api/grade-answer.js
// Keyword-based grading — no API key needed, completely free

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { answer, keywords } = req.body
  // keywords: array of strings provided by the teacher, e.g. ["енергия","АТФ","дишане"]

  if (!answer) return res.status(400).json({ error: 'Missing answer' })

  const normalizedAnswer = answer.toLowerCase()

  const kwList = Array.isArray(keywords) ? keywords : []

  if (kwList.length === 0) {
    // No keywords set — just acknowledge receipt
    return res.status(200).json({
      score: null,
      matched: [],
      total: 0,
      feedback: 'Отговорът е получен. Учителят не е задал ключови думи.'
    })
  }

  // Find which keywords appear in the answer (simple includes check)
  const matched = kwList.filter(kw =>
    normalizedAnswer.includes(kw.toLowerCase().trim())
  )

  const score = Math.round((matched.length / kwList.length) * 100)

  let feedback
  if (score === 100) {
    feedback = `Отличен отговор! Съдържа всички ключови думи: ${matched.join(', ')}.`
  } else if (score >= 60) {
    const missing = kwList.filter(k => !matched.includes(k))
    feedback = `Добър отговор. Намерени: ${matched.join(', ')}. Липсват: ${missing.join(', ')}.`
  } else if (score > 0) {
    const missing = kwList.filter(k => !matched.includes(k))
    feedback = `Непълен отговор. Намерени: ${matched.join(', ')}. Липсват: ${missing.join(', ')}.`
  } else {
    feedback = `Отговорът не съдържа очакваните ключови думи: ${kwList.join(', ')}.`
  }

  return res.status(200).json({ score, matched, total: kwList.length, feedback })
}
