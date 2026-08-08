(function () {
  "use strict";

  const pad = (value) => String(value).padStart(2, "0");

  function localDate(daysFromToday, hour, minute) {
    const date = new Date();
    date.setHours(hour || 0, minute || 0, 0, 0);
    date.setDate(date.getDate() + daysFromToday);
    return date;
  }

  function isoDay(daysFromToday) {
    const date = localDate(daysFromToday, 12, 0);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function isoTime(daysFromToday, hour, minute) {
    return localDate(daysFromToday, hour, minute).toISOString();
  }

  function createDemoData() {
    const families = [
      {
        id: "fam-1",
        display_name: "Famiglia Bianchi",
        guardian_name: "Giulia Bianchi",
        email: "giulia.bianchi@example.com",
        phone: "333 555 0112",
        notes: "",
      },
      {
        id: "fam-2",
        display_name: "Famiglia Rossi",
        guardian_name: "Marco Rossi",
        email: "marco.rossi@example.com",
        phone: "333 555 0137",
        notes: "Preferisce comunicazioni via e-mail.",
      },
      {
        id: "fam-3",
        display_name: "Famiglia Conti",
        guardian_name: "Sara Conti",
        email: "sara.conti@example.com",
        phone: "333 555 0179",
        notes: "",
      },
      {
        id: "fam-4",
        display_name: "Famiglia Esposito",
        guardian_name: "Luca Esposito",
        email: "luca.esposito@example.com",
        phone: "333 555 0191",
        notes: "",
      },
    ];

    const students = [
      {
        id: "stu-1",
        family_id: "fam-1",
        first_name: "Emma",
        last_name: "Bianchi",
        birth_date: "2022-04-18",
        fiscal_code: "BNCMMA22D58G702X",
        residence_address: "Via delle Note 12, Pisa",
        notes: "Ama le attività con il paracadute.",
        is_active: true,
      },
      {
        id: "stu-2",
        family_id: "fam-1",
        first_name: "Tommaso",
        last_name: "Bianchi",
        birth_date: "2018-11-03",
        notes: "",
        is_active: true,
      },
      {
        id: "stu-3",
        family_id: "fam-2",
        first_name: "Sofia",
        last_name: "Rossi",
        birth_date: "2021-07-22",
        notes: "",
        is_active: true,
      },
      {
        id: "stu-4",
        family_id: "fam-3",
        first_name: "Nicolò",
        last_name: "Conti",
        birth_date: "2016-02-09",
        notes: "Lezione individuale.",
        is_active: true,
      },
      {
        id: "stu-5",
        family_id: "fam-4",
        first_name: "Mia",
        last_name: "Esposito",
        birth_date: "2020-09-14",
        notes: "",
        is_active: true,
      },
    ];

    const courses = [
      {
        id: "course-1",
        name: "Musica 0–3 anni",
        color: "#0fa7b8",
        location: "Studio Quarto MoVimento",
        duration_minutes: 45,
        is_active: true,
      },
      {
        id: "course-2",
        name: "Pianoforte 3–6 anni",
        color: "#08457c",
        location: "Studio Quarto MoVimento",
        duration_minutes: 50,
        is_active: true,
      },
      {
        id: "course-3",
        name: "Pianoforte 6+",
        color: "#ff8f04",
        location: "Studio Quarto MoVimento",
        duration_minutes: 60,
        is_active: true,
      },
      {
        id: "course-4",
        name: "Lezione individuale",
        color: "#2c9c87",
        location: "Studio Quarto MoVimento",
        duration_minutes: 50,
        is_active: true,
      },
    ];

    const enrollments = [
      {
        id: "enr-1",
        student_id: "stu-1",
        course_id: "course-1",
        plan_type: "annual",
        starts_on: isoDay(-120),
        ends_on: isoDay(240),
        notes: "Pagamento annuale in due rate.",
        is_active: true,
      },
      {
        id: "enr-2",
        student_id: "stu-2",
        course_id: "course-3",
        plan_type: "semester",
        starts_on: isoDay(-90),
        ends_on: isoDay(150),
        is_active: true,
      },
      {
        id: "enr-3",
        student_id: "stu-3",
        course_id: "course-1",
        plan_type: "monthly",
        starts_on: isoDay(-60),
        ends_on: isoDay(90),
        is_active: true,
      },
      {
        id: "enr-4",
        student_id: "stu-4",
        course_id: "course-4",
        plan_type: "annual",
        starts_on: isoDay(-130),
        ends_on: isoDay(240),
        is_active: true,
      },
      {
        id: "enr-5",
        student_id: "stu-5",
        course_id: "course-2",
        plan_type: "semester",
        starts_on: isoDay(-75),
        ends_on: isoDay(150),
        is_active: true,
      },
    ];

    const lessonSpecs = [
      ["lesson-1", "course-1", -21, 16, 30, "regular", "completed"],
      ["lesson-2", "course-3", -19, 17, 30, "regular", "completed"],
      ["lesson-3", "course-4", -17, 15, 30, "regular", "completed"],
      ["lesson-4", "course-2", -15, 16, 30, "regular", "completed"],
      ["lesson-5", "course-1", -14, 16, 30, "regular", "completed"],
      ["lesson-6", "course-3", -12, 17, 30, "regular", "completed"],
      ["lesson-7", "course-4", -10, 15, 30, "regular", "completed"],
      ["lesson-8", "course-2", -8, 16, 30, "regular", "completed"],
      ["lesson-9", "course-1", -7, 16, 30, "regular", "completed"],
      ["lesson-10", "course-3", -5, 17, 30, "regular", "completed"],
      ["lesson-11", "course-4", -3, 15, 30, "regular", "completed"],
      ["lesson-12", "course-2", -1, 16, 30, "regular", "completed"],
      ["lesson-13", "course-1", 0, 16, 30, "regular", "scheduled"],
      ["lesson-14", "course-3", 0, 17, 30, "regular", "scheduled"],
      ["lesson-15", "course-4", 1, 15, 30, "regular", "scheduled"],
      ["lesson-16", "course-2", 2, 16, 30, "regular", "scheduled"],
      ["lesson-17", "course-1", 7, 16, 30, "regular", "scheduled"],
      ["lesson-18", "course-3", 7, 17, 30, "regular", "scheduled"],
      ["lesson-19", "course-4", 8, 15, 30, "regular", "scheduled"],
      ["lesson-20", "course-2", 9, 16, 30, "regular", "scheduled"],
      ["lesson-21", "course-1", 14, 16, 30, "regular", "scheduled"],
      ["lesson-22", "course-3", 14, 17, 30, "makeup", "scheduled"],
      ["lesson-23", "course-4", 15, 15, 30, "regular", "scheduled"],
      ["lesson-24", "course-2", 16, 16, 30, "regular", "scheduled"],
    ];

    const lessons = lessonSpecs.map(
      ([id, courseId, day, hour, minute, lessonType, status]) => {
        const course = courses.find((item) => item.id === courseId);
        const startsAt = localDate(day, hour, minute);
        const endsAt = new Date(
          startsAt.getTime() + course.duration_minutes * 60 * 1000,
        );
        return {
          id,
          course_id: courseId,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          lesson_type: lessonType,
          status,
          title: lessonType === "makeup" ? "Recupero di gruppo" : course.name,
          location: course.location,
          notes: "",
        };
      },
    );

    const attendance = [
      ["att-1", "lesson-1", "stu-1", "present"],
      ["att-2", "lesson-1", "stu-3", "present"],
      ["att-3", "lesson-2", "stu-2", "present"],
      ["att-4", "lesson-3", "stu-4", "present"],
      ["att-5", "lesson-4", "stu-5", "present"],
      ["att-6", "lesson-5", "stu-1", "absent_excused"],
      ["att-7", "lesson-5", "stu-3", "present"],
      ["att-8", "lesson-6", "stu-2", "present"],
      ["att-9", "lesson-7", "stu-4", "absent_unexcused"],
      ["att-10", "lesson-8", "stu-5", "present"],
      ["att-11", "lesson-9", "stu-1", "present"],
      ["att-12", "lesson-9", "stu-3", "absent_excused"],
      ["att-13", "lesson-10", "stu-2", "present"],
      ["att-14", "lesson-11", "stu-4", "present"],
      ["att-15", "lesson-12", "stu-5", "present"],
    ].map(([id, lessonId, studentId, status]) => ({
      id,
      lesson_id: lessonId,
      student_id: studentId,
      status,
      recorded_at: new Date().toISOString(),
      notes: "",
    }));

    const invoices = [
      {
        id: "inv-1",
        family_id: "fam-1",
        student_id: "stu-1",
        number: "QM-2026-041",
        title: "Quota corso · maggio",
        description: "Frequenza mensile",
        total_cents: 6800,
        currency: "EUR",
        due_date: isoDay(-35),
        status: "paid",
        payment_method: "bank_transfer",
        paid_at: isoTime(-37, 10, 20),
      },
      {
        id: "inv-2",
        family_id: "fam-1",
        student_id: "stu-2",
        number: "QM-2026-052",
        title: "Seconda rata abbonamento",
        description: "Pianoforte 6+ · rata 2 di 2",
        total_cents: 24000,
        currency: "EUR",
        due_date: isoDay(10),
        status: "pending",
        payment_method: null,
        paid_at: null,
      },
      {
        id: "inv-3",
        family_id: "fam-2",
        student_id: "stu-3",
        number: "QM-2026-049",
        title: "Quota corso · mese corrente",
        description: "Pacchetto di 4 lezioni",
        total_cents: 6800,
        currency: "EUR",
        due_date: isoDay(-6),
        status: "overdue",
        payment_method: null,
        paid_at: null,
      },
      {
        id: "inv-4",
        family_id: "fam-3",
        student_id: "stu-4",
        number: "QM-2026-050",
        title: "Terza rata abbonamento",
        description: "Lezioni individuali",
        total_cents: 31000,
        currency: "EUR",
        due_date: isoDay(4),
        status: "pending",
        payment_method: null,
        paid_at: null,
      },
      {
        id: "inv-5",
        family_id: "fam-4",
        student_id: "stu-5",
        number: "QM-2026-046",
        title: "Quota semestrale",
        description: "Pianoforte 3–6 anni",
        total_cents: 21000,
        currency: "EUR",
        due_date: isoDay(-18),
        status: "paid",
        payment_method: "paypal",
        paid_at: isoTime(-19, 18, 5),
      },
    ];

    const payments = [
      {
        id: "pay-1",
        invoice_id: "inv-1",
        family_id: "fam-1",
        amount_cents: 6800,
        refunded_cents: 0,
        currency: "EUR",
        method: "bank_transfer",
        status: "completed",
        provider: "manual",
        reference: "QM-2026-041",
        paid_at: isoTime(-37, 10, 20),
        created_at: isoTime(-37, 10, 20),
      },
      {
        id: "pay-2",
        invoice_id: "inv-3",
        family_id: "fam-2",
        amount_cents: 1800,
        refunded_cents: 0,
        currency: "EUR",
        method: "cash",
        status: "completed",
        provider: "manual",
        reference: "Acconto",
        paid_at: isoTime(-8, 18, 0),
        created_at: isoTime(-8, 18, 0),
      },
      {
        id: "pay-3",
        invoice_id: "inv-5",
        family_id: "fam-4",
        amount_cents: 21000,
        refunded_cents: 0,
        currency: "EUR",
        method: "paypal",
        status: "completed",
        provider: "paypal",
        reference: "DEMO-PAYPAL",
        paid_at: isoTime(-19, 18, 5),
        created_at: isoTime(-19, 18, 5),
      },
    ];

    const bankTransferNotices = [
      {
        id: "notice-1",
        invoice_id: "inv-4",
        family_id: "fam-3",
        amount_cents: 31000,
        transfer_date: isoDay(-1),
        reference: "TRN-DEMO-310",
        note: "",
        status: "submitted",
        review_note: null,
        created_at: isoTime(-1, 17, 45),
      },
    ];

    const makeupCredits = [
      {
        id: "makeup-1",
        student_id: "stu-1",
        source_lesson_id: "lesson-5",
        used_lesson_id: null,
        status: "available",
        reason: "Assenza comunicata nei termini",
        expires_on: isoDay(120),
        created_at: isoTime(-14, 18, 0),
      },
      {
        id: "makeup-2",
        student_id: "stu-3",
        source_lesson_id: "lesson-9",
        used_lesson_id: null,
        status: "not_eligible",
        reason: "Piano mensile: recupero non previsto",
        expires_on: null,
        created_at: isoTime(-7, 18, 0),
      },
      {
        id: "makeup-3",
        student_id: "stu-2",
        source_lesson_id: "lesson-2",
        used_lesson_id: "lesson-22",
        status: "scheduled",
        reason: "Recupero concordato",
        expires_on: isoDay(150),
        created_at: isoTime(-18, 18, 0),
      },
    ];

    const familyNotifications = [
      {
        id: "family-notification-1",
        family_id: "fam-1",
        student_id: "stu-1",
        kind: "schedule",
        message: "Possiamo verificare insieme l’orario della prossima lezione?",
        status: "unread",
        created_at: isoTime(-1, 19, 15),
      },
    ];

    return {
      families,
      students,
      courses,
      enrollments,
      lessons,
      attendance,
      invoices,
      payments,
      bankTransferNotices,
      makeupCredits,
      familyNotifications,
      settings: {
        school_name: "Studio Quarto MoVimento",
        school_address: "Via di Novecchio, 10 · Pisa",
        support_email: "valeria@quartomovimento.it",
        support_phone: "327 774 9860",
        bank_account_holder: "Valeria d’Argenio",
        bank_iban: "IT00 X000 0000 0000 0000 0000 000",
        bank_bic: "DEMOIT00",
        bank_reference_template: "{nome}, {cognome}, {numero}",
        academic_year_label: "Anno didattico in corso",
        absence_notice_hours: 24,
      },
    };
  }

  window.QM_DEMO = { createDemoData };
})();
