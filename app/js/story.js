/*
 * The scripted parts of the demo. Everything else (entries, proposals, screening,
 * history, undo) is live state in app.js.
 *
 * The chat answers are templates, not AI. They are filled in from whatever the
 * store holds at that moment, so an edit to an entry changes both answers.
 */
(function (global) {
  "use strict";

  var SCREENS = [
    {
      id: "context",
      nav: "Your context",
      title: "Your context",
      sub: "What your assistants may know about you. Only you can change it."
    },
    {
      id: "assistants",
      nav: "Assistants",
      title: "Connected assistants",
      sub: "Each assistant reads only what you allow, and the store logs every read."
    },
    {
      id: "proposals",
      nav: "Proposals",
      title: "Proposals",
      sub: "Assistants can suggest changes. Nothing changes until you accept it."
    },
    {
      id: "same-you",
      nav: "Same you",
      title: "Same you, different assistant",
      sub: "Two assistants from different companies read the same context."
    },
    {
      id: "connect",
      nav: "Connect",
      title: "Connect your context",
      sub: "A new assistant asks once. You choose what it may read."
    },
    {
      id: "history",
      nav: "History",
      title: "History",
      sub: "Every change, who proposed it and who approved it. Any change can be undone."
    }
  ];

  var ASSISTANT_D = {
    id: "assistant-d",
    name: "Assistant D",
    description: "Research assistant",
    location: "cloud",
    scopes: [],
    may_read_sensitive: false,
    may_propose: true,
    daily_limit: 20,
    status: "active",
    connected: null
  };

  var REQUEST = "Help me write an email to my supervisor.";

  // Words that differ between British and American spelling in the answers.
  function spell(word, british) {
    var us = { organised: "organized", summarised: "summarized", analysed: "analyzed" };
    return british ? word : us[word] || word;
  }

  function signoffLines(signoff) {
    var i = signoff.indexOf(",");
    if (i === -1) return [signoff];
    return [signoff.slice(0, i + 1), signoff.slice(i + 1).trim()];
  }

  /*
   * ctx: what the assistant learned from the store, or null without context.
   *   { british, short, supervisor, deadline, topic, signoff }
   * Returns { intro, to, subject, paras: [ [ {t, ph?, key?} ] ], sign: [ {t, ph?, key?} ] }
   * where ph marks a placeholder and key names the store value that produced the text.
   */
  function answer(assistantId, ctx) {
    if (!ctx) return generic(assistantId);
    var br = ctx.british;
    var who = ctx.supervisor ? { t: ctx.supervisor, key: "supervisor" } : { t: "[Supervisor’s name]", ph: true };
    // The recipient comes from the store too, so a planted address would show up here.
    var to = ctx.supervisorEmail ? { t: ctx.supervisorEmail, key: "supervisor" }
      : ctx.supervisor ? { t: ctx.supervisor, key: "supervisor" } : { t: "[Supervisor’s email]", ph: true };
    var date = ctx.deadline ? { t: ctx.deadline, key: "deadline" } : null;
    var topic = ctx.topic ? { t: ctx.topic, key: "topic" } : null;
    var sign = ctx.signoff
      ? signoffLines(ctx.signoff).map(function (t) { return { t: t, key: "signoff" }; })
      : [{ t: "Best regards," }, { t: "[Your name]", ph: true }];

    if (assistantId === "assistant-b") {
      var b1 = [{ t: br ? "A quick update: the chapter 2 draft of my thesis" : "Just a quick update: the chapter 2 draft of my thesis" }];
      if (topic) b1.push({ t: " on " }, topic);
      if (date) b1.push({ t: " will reach you by " }, date, { t: "." });
      else b1.push({ t: " is coming along well." });
      var b2 = [{ t: "Would you have 20 minutes next week to look at its structure? I’ve " + spell("summarised", br) + " the main findings so far." }];
      var paras = [[{ t: "Dear " }, who, { t: "," }], b1, b2];
      if (!ctx.short) {
        paras.push([{ t: "I would also welcome your view on whether the scope still fits the time I have left, and on the sources I plan to add. I can adapt to whatever day and time suit you best." }]);
      }
      return {
        intro: ctx.short ? "Draft below." : "Here is a draft. I added a paragraph on scope, which you can drop if you like:",
        to: to,
        subject: "Chapter 2: update and a short meeting",
        paras: paras,
        sign: sign
      };
    }

    var a1 = [{ t: "I’m on track to send you my chapter 2 draft" }];
    if (topic) a1.push({ t: " on " }, topic);
    if (date) a1.push({ t: " by " }, date);
    a1.push({ t: "." });
    var a2 = [{ t: "Could we meet for 20 minutes next week to check how I’ve " + spell("organised", br) + " the analysis?" }];
    var parasA = [[{ t: "Dear " }, who, { t: "," }], a1, a2];
    if (!ctx.short) {
      parasA.push([{ t: "I would also like to hear whether the structure of the analysis section works for you, and whether anything is missing before I continue with chapter 3. Please let me know which day and time would suit you." }]);
    }
    return {
      intro: ctx.short ? "Here’s a short draft:" : "Here’s a draft you can adapt. I kept it polite and complete:",
      to: to,
      subject: "Chapter 2 draft",
      paras: parasA,
      sign: sign
    };
  }

  function generic(assistantId) {
    if (assistantId === "assistant-b") {
      return {
        intro: "Of course! Here is a template you can customize:",
        to: { t: "[Professor’s email]", ph: true },
        subject: "Request for a Meeting",
        paras: [
          [{ t: "Dear Professor " }, { t: "[Last Name]", ph: true }, { t: "," }],
          [{ t: "I am reaching out to request a meeting to discuss my thesis. I would like to share my progress so far, talk through some challenges I have encountered, and agree on a timeline for the upcoming chapters." }],
          [{ t: "I am flexible and happy to adapt to your schedule. Thank you in advance for your time and support." }]
        ],
        sign: [{ t: "Kind regards," }, { t: "[Your Name]", ph: true }, { t: "[Student Number]", ph: true }]
      };
    }
    return {
      intro: "Sure! Here’s a professional email you can adapt to your situation:",
      to: { t: "[Supervisor’s email]", ph: true },
      subject: "Meeting Request Regarding My Project",
      paras: [
        [{ t: "Dear " }, { t: "[Supervisor’s Name]", ph: true }, { t: "," }],
        [{ t: "I hope this email finds you well. I am writing to ask whether you would have time to meet in the coming weeks to discuss the progress of my project. I have organized my recent work and would greatly appreciate your feedback on the next steps." }],
        [{ t: "Please let me know which day and time would be most convenient for you. Thank you for your time and guidance." }]
      ],
      sign: [{ t: "Best regards," }, { t: "[Your Name]", ph: true }]
    };
  }

  global.STORY = {
    now: "2026-11-19T07:20:00Z", // the demo's clock starts at 08:20 Brussels time on the day of the talk
    screens: SCREENS,
    assistantD: ASSISTANT_D,
    request: REQUEST,
    answer: answer
  };
})(window);
