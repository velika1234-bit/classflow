-- ClassFlow Database Schema
-- Run this in Supabase SQL Editor

-- Sessions table
CREATE TABLE sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pin VARCHAR(6) UNIQUE NOT NULL,
  title VARCHAR(200) NOT NULL DEFAULT 'Урок',
  teacher_id TEXT NOT NULL,
  current_slide INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Slides table (each slide in the deck)
CREATE TABLE slides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('pdf', 'poll', 'wordcloud', 'drawing', 'freetext')),
  content JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Students table
CREATE TABLE students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  joined_at TIMESTAMPTZ DEFAULT NOW()
);

-- Poll answers
CREATE TABLE poll_answers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  slide_id UUID REFERENCES slides(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  choice_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(slide_id, student_id)
);

-- Word cloud submissions
CREATE TABLE word_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  slide_id UUID REFERENCES slides(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  word VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Drawing submissions (base64 canvas data)
CREATE TABLE drawing_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  slide_id UUID REFERENCES slides(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  student_name VARCHAR(100),
  image_data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Free text / open answers
CREATE TABLE freetext_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  slide_id UUID REFERENCES slides(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  student_name VARCHAR(100),
  answer TEXT NOT NULL,
  ai_score INTEGER,
  ai_feedback TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Realtime on all tables
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE slides;
ALTER PUBLICATION supabase_realtime ADD TABLE students;
ALTER PUBLICATION supabase_realtime ADD TABLE poll_answers;
ALTER PUBLICATION supabase_realtime ADD TABLE word_submissions;
ALTER PUBLICATION supabase_realtime ADD TABLE drawing_submissions;
ALTER PUBLICATION supabase_realtime ADD TABLE freetext_submissions;

-- Row Level Security (allow all for simplicity - tighten for production)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE word_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE drawing_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE freetext_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public access" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON slides FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON students FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON poll_answers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON word_submissions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON drawing_submissions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access" ON freetext_submissions FOR ALL USING (true) WITH CHECK (true);
