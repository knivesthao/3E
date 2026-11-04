-- Classes, enrollment, class curriculum, and personal shelves.
-- Published books live in LIBRARY_DB, which D1 cannot reference across
-- databases, so book_id values are validated at the API boundary instead of
-- with foreign keys. User and class references stay inside the app DB.
CREATE TABLE classes (
  id          TEXT PRIMARY KEY,
  teacher_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('A1','A2','B1','B2','C1','C2')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_classes_teacher ON classes(teacher_id);

-- One teacher owns the class; many students enroll. Students may belong to
-- many classes; teacher substitution is deferred, so no second teacher role.
CREATE TABLE class_students (
  class_id  TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at  TEXT NOT NULL,
  PRIMARY KEY (class_id, user_id)
);

CREATE INDEX idx_class_students_user ON class_students(user_id);

-- Ordered curriculum entries pointing at published library books.
CREATE TABLE class_books (
  class_id  TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  book_id   TEXT NOT NULL,
  position  INTEGER NOT NULL,
  added_at  TEXT NOT NULL,
  PRIMARY KEY (class_id, book_id),
  UNIQUE (class_id, position)
);

CREATE INDEX idx_class_books_book ON class_books(book_id);

-- Personal student shelf: books the learner saved for later. Assigned class
-- books are read from class_books; finished books remain derived separately.
CREATE TABLE library_shelf (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id   TEXT NOT NULL,
  added_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, book_id)
);

CREATE INDEX idx_library_shelf_book ON library_shelf(book_id);
