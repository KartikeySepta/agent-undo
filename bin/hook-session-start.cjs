"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/ignore/index.js
var require_ignore = __commonJS({
  "node_modules/ignore/index.js"(exports2, module2) {
    function makeArray(subject) {
      return Array.isArray(subject) ? subject : [subject];
    }
    var UNDEFINED = void 0;
    var EMPTY = "";
    var SPACE = " ";
    var ESCAPE = "\\";
    var REGEX_LITERAL_SPECIAL = /[.*+?()[\]{}^$|\\/]/;
    var BOM = "\uFEFF";
    var REGEX_INVALID_TRAILING_BACKSLASH = /(?:[^\\]|^)\\$/;
    var REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION = /^\\!/;
    var REGEX_REPLACE_LEADING_EXCAPED_HASH = /^\\#/;
    var REGEX_SPLITALL_CRLF = /\r?\n/g;
    var DOUBLE_SLASH = "//";
    var SLASH_CODE = 47;
    var DOT_CODE = 46;
    var SLASH = "/";
    var TMP_KEY_IGNORE = "node-ignore";
    if (typeof Symbol !== "undefined") {
      TMP_KEY_IGNORE = /* @__PURE__ */ Symbol.for("node-ignore");
    }
    var KEY_IGNORE = TMP_KEY_IGNORE;
    var define = (object, key, value) => {
      Object.defineProperty(object, key, { value });
      return value;
    };
    var RETURN_FALSE = () => false;
    var cleanRangeBackSlash = (slashes) => {
      const { length } = slashes;
      return slashes.slice(0, length - length % 2);
    };
    var POSIX_CLASSES = {
      alnum: "0-9A-Za-z",
      alpha: "A-Za-z",
      blank: " \\t",
      cntrl: "\\x00-\\x1f\\x7f",
      digit: "0-9",
      graph: "!-.0-~",
      lower: "a-z",
      print: " -.0-~",
      punct: "!-.:-@\\[-`{-~",
      // git's `sane-ctype.h` classifies \v and \f as control, not space,
      //   unlike C's `isspace`
      space: " \\t\\n\\r",
      upper: "A-Z",
      xdigit: "0-9A-Fa-f"
    };
    var CLASS_MEMBERS_TO_ESCAPE = "\\]^-[";
    var escapeMember = (char) => CLASS_MEMBERS_TO_ESCAPE.indexOf(char) < 0 ? char : ESCAPE + char;
    var NON_SLASH = "(?!\\/)";
    var classSource = (negated, body) => {
      if (negated) {
        return `[^\\/${body}]`;
      }
      const source = `[${body}]`;
      return new RegExp(source).test("/") ? NON_SLASH + source : source;
    };
    var scanBracket = (pattern, start) => {
      const { length } = pattern;
      let index = start + 1;
      let negated = EMPTY;
      const lead = pattern[index];
      if (lead === "!" || lead === "^") {
        negated = "^";
        index++;
      }
      let body = EMPTY;
      let prev = EMPTY;
      for (; ; ) {
        const char = pattern[index];
        if (char === UNDEFINED) {
          return null;
        }
        if (char === ESCAPE) {
          const escaped = pattern[index + 1];
          if (escaped === UNDEFINED) {
            return null;
          }
          body += escapeMember(escaped);
          prev = escaped;
          index++;
        } else if (char === "-" && prev && index + 1 < length && pattern[index + 1] !== "]") {
          index++;
          let to = pattern[index];
          if (to === ESCAPE) {
            to = pattern[index += 1];
          }
          if (prev <= to) {
            body += `-${escapeMember(to)}`;
          }
          prev = EMPTY;
        } else if (char === "[" && pattern[index + 1] === ":") {
          const nameStart = index + 2;
          let end = nameStart;
          while (end < length && pattern[end] !== "]") {
            end++;
          }
          if (end === length) {
            return null;
          }
          if (end > nameStart && pattern[end - 1] === ":") {
            const expanded = POSIX_CLASSES[pattern.slice(nameStart, end - 1)];
            if (expanded === UNDEFINED) {
              return null;
            }
            body += expanded;
            prev = EMPTY;
            index = end;
          } else {
            body += escapeMember("[");
            prev = "[";
            index = nameStart - 2;
          }
        } else {
          body += escapeMember(char);
          prev = char;
        }
        index++;
        if (pattern[index] === "]") {
          return {
            end: index,
            source: classSource(negated, body)
          };
        }
      }
    };
    var NEVER_MATCH = "[]";
    var PLACEHOLDER = "\0";
    var REGEX_RESTORE_PLACEHOLDER = new RegExp(
      `${PLACEHOLDER}(\\d+)${PLACEHOLDER}`,
      "g"
    );
    var TRAILING_WILDCARD = "\uE000";
    var TRAILING_DOUBLESTAR = "\uE001";
    var extractBrackets = (pattern) => {
      const sources = [];
      const hold = (source) => `${PLACEHOLDER}${sources.push(source) - 1}${PLACEHOLDER}`;
      const { length } = pattern;
      let out = EMPTY;
      let index = 0;
      while (index < length) {
        const char = pattern[index];
        if (char === ESCAPE) {
          const escaped = pattern[index + 1];
          if (escaped === UNDEFINED || escaped === SLASH && index + 2 === length) {
            out += hold(NEVER_MATCH);
          } else if (escaped === "*" || escaped === "[" || escaped === SPACE || escaped === ESCAPE) {
            out += pattern.slice(index, index + 2);
          } else {
            out += hold(
              REGEX_LITERAL_SPECIAL.test(escaped) ? ESCAPE + escaped : escaped
            );
          }
          index += 2;
        } else if (char === PLACEHOLDER) {
          out += hold(`[${PLACEHOLDER}]`);
          index++;
        } else if (char === "[") {
          const scanned = scanBracket(pattern, index);
          if (scanned === null) {
            out += hold(NEVER_MATCH);
            index = length;
          } else {
            out += hold(scanned.source);
            index = scanned.end + 1;
          }
        } else {
          out += char;
          index++;
        }
      }
      return {
        source: out,
        sources
      };
    };
    var DIRECT = null;
    var REGEX_INNER_SLASH = /\/(?!$)/;
    var REPLACERS = [
      // Replace (\ ) with ' '
      // Only a space: an escaped tab or other whitespace is already a literal by
      //   the time it reaches here, and a bare tab must be left as one, not turned
      //   into a space.
      // (\ ) -> ' '
      // (\\ ) -> '\\ '
      // (\\\ ) -> '\\ '
      [
        // A run of backslashes is taken whole, from its first one, so no match
        //   ever starts again inside it -- `(\\+?) ` did, which made a long run
        //   quadratic.
        /(\\+)( ?)/g,
        (_, run, space) => space ? run.slice(0, run.length - run.length % 2) + SPACE : run,
        ESCAPE + SPACE
      ],
      // Escape metacharacters
      // which is written down by users but means special for regular expressions.
      // > There are 12 characters with special meanings:
      // > - the backslash \,
      // > - the caret ^,
      // > - the dollar sign $,
      // > - the period or dot .,
      // > - the vertical bar or pipe symbol |,
      // > - the question mark ?,
      // > - the asterisk or star *,
      // > - the plus sign +,
      // > - the opening parenthesis (,
      // > - the closing parenthesis ),
      // > - and the opening square bracket [,
      // > - the opening curly brace {,
      // > These special characters are often called "metacharacters".
      [
        /[\\$.|*+(){^]/g,
        (match) => `\\${match}`
      ],
      [
        // > a question mark (?) matches a single character
        /(?!\\)\?/g,
        () => "[^/]",
        "?"
      ],
      // leading slash
      [
        // > A leading slash matches the beginning of the pathname.
        // > For example, "/*.c" matches "cat-file.c" but not "mozilla-sha1/sha1.c".
        // A leading slash matches the beginning of the pathname
        /^\//,
        () => "^",
        SLASH
      ],
      // replace special metacharacter slash after the leading slash
      [
        /\//g,
        () => "\\/",
        SLASH
      ],
      [
        // > A leading "**" followed by a slash means match in all directories.
        // > For example, "**/foo" matches file or directory "foo" anywhere,
        // > the same as pattern "foo".
        // > "**/foo/bar" matches file or directory "bar" anywhere that is directly
        // >   under directory "foo".
        // Notice that the '*'s have been replaced as '\\*'
        /^\^*(?:\\\*\\\*\\\/)+/,
        // '**/foo' <-> 'foo'
        () => "^(?:.*\\/)?",
        "*"
      ],
      // starting
      [
        // there will be no leading '/'
        //   (which has been replaced by section "leading slash")
        // If starts with '**', adding a '^' to the regular expression also works
        DIRECT,
        (source, pattern) => {
          if (!source || source[0] === "^") {
            return source;
          }
          const anchor = !REGEX_INNER_SLASH.test(pattern) ? "(?:^|\\/)" : "^";
          return anchor + source;
        }
      ],
      // two globstars
      [
        // Use lookahead assertions so that we could match more than one `'/**'`
        /\\\/\\\*\\\*(?=\\\/|$)/g,
        // Zero, one or several directories
        // should not use '*', or it will be replaced by the next replacer
        // Check if it is not the last `'/**'`
        (_, index, str) => index + 6 < str.length ? str.slice(index + 6) === "\\/" ? "(?:\\/[^\\/]+)+" : "(?:\\/[^\\/]+)*" : `\\/${TRAILING_DOUBLESTAR}`,
        "*"
      ],
      // normal intermediate wildcards
      [
        // Never replace escaped '*'
        // ignore rule '\*' will match the path '*'
        // 'abc.*/' -> go
        // 'abc.*'  -> skip this rule,
        //    coz trailing single wildcard will be handed by [trailing wildcard]
        /(^|[^\\]+)(\\\*)+(?=.+)/g,
        // '*.js' matches '.js'
        // '*.js' doesn't match 'abc'
        (_, p1, p2) => {
          const unescaped = p2.replace(/\\\*/g, "[^\\/]*");
          return p1 + unescaped;
        },
        "*"
      ],
      // trailing wildcard, held apart from a literal star
      [
        // The step above leaves a trailing `*` alone, so a single `\*` is all that
        //   can be left at the end here. Whether it is a wildcard or a literal
        //   turns on the backslashes the user put in front of it: the escaper has
        //   since doubled every one, so what stands here is those `2N` doubled
        //   backslashes and then the star's own escape. An even number of the
        //   original `N` leaves the star unescaped -- a wildcard -- and an odd
        //   number escapes it -- a literal. This runs while the two are still
        //   distinct, before the unescape steps below collapse the literal onto
        //   the very `\*` a wildcard leaves behind.
        /(^|[^\\])((?:\\\\)*)\\\*$/,
        (match, p1, p2) => (
          // `p2` holds the doubled user backslashes; half of them is `N`.
          p2.length / 2 % 2 === 0 ? p1 + p2 + TRAILING_WILDCARD : match
        ),
        "*"
      ],
      [
        // unescape, revert step 3 except for back slash
        // For example, if a user escape a '\\*',
        // after step 3, the result will be '\\\\\\*'
        /\\\\\\(?=[$.|*+(){^])/g,
        () => ESCAPE,
        ESCAPE + ESCAPE
      ],
      [
        // '\\\\' -> '\\'
        /\\\\/g,
        () => ESCAPE,
        ESCAPE + ESCAPE
      ],
      [
        // Every real bracket expression -- POSIX classes included -- has already
        //   been held aside by `extractBrackets`, so the only `[` left in the
        //   pattern is an escaped, literal one.
        // `\` is escaped by step 3
        /\\\[([^\]/]*?)(\\*)($|\])/g,
        // '\\[bar]' -> '\\\\[bar\\]'
        (match, range, endEscape, close) => `\\[${range}${cleanRangeBackSlash(endEscape)}${close}`,
        "["
      ],
      // ending
      [
        // 'js' will not match 'js.'
        // 'ab' will not match 'abc'
        DIRECT,
        // WTF!
        // https://git-scm.com/docs/gitignore
        // changes in [2.22.1](https://git-scm.com/docs/gitignore/2.22.1)
        // which re-fixes #24, #38
        // > If there is a separator at the end of the pattern then the pattern
        // > will only match directories, otherwise the pattern can match both
        // > files and directories.
        // 'js*' will not match 'a.js'
        // 'js/' will not match 'a.js'
        // 'js' will match 'a.js' and 'a.js/'
        (source) => {
          const last = source[source.length - 1];
          if (!last || last === TRAILING_WILDCARD || last === TRAILING_DOUBLESTAR) {
            return source;
          }
          return last === SLASH ? `${source}$` : `${source}(?=$|\\/$)`;
        }
      ]
    ];
    var REGEX_REPLACE_TRAILING_WILDCARD = /(^|\\\/)?\uE000$/;
    var MODE_IGNORE = "regex";
    var MODE_CHECK_IGNORE = "checkRegex";
    var UNDERSCORE = "_";
    var replaceTrailingWildcard = (_, p1) => {
      const prefix = p1 ? `${p1}[^/]+` : "[^/]*";
      return `${prefix}(?=$|\\/$)`;
    };
    var REGEX_REPLACE_TRAILING_DOUBLESTAR = /\uE001$/;
    var replaceTrailingDoublestar = () => ".+(?=$|\\/$)";
    var WILDCARD = "[^\\/]*";
    var separatorAfter = (run, at) => {
      let separator = EMPTY;
      for (let index = at + 1; index < run.length && !run[index].wildcard; index++) {
        separator += run[index].single;
      }
      return separator;
    };
    var pinWildcards = (source) => {
      if (source.indexOf(WILDCARD) < 0) {
        return source;
      }
      const tokens = [];
      const { length } = source;
      let index = 0;
      while (index < length) {
        const char = source[index];
        if (source.startsWith(WILDCARD, index)) {
          tokens.push({ wildcard: true });
          index += WILDCARD.length;
        } else if (char === "[") {
          let end = index + 1;
          if (source[end] === "^") {
            end++;
          }
          if (source[end] === "]") {
            end++;
          }
          while (end < length && source[end] !== "]") {
            end += source[end] === ESCAPE ? 2 : 1;
          }
          end++;
          tokens.push({ single: source.slice(index, end) });
          index = end;
        } else if (char === ESCAPE) {
          tokens.push({ single: source.slice(index, index + 2) });
          index += 2;
        } else if (char === "(") {
          let depth = 0;
          let end = index;
          do {
            if (source[end] === ESCAPE) {
              end++;
            } else if (source[end] === "(") {
              depth++;
            } else if (source[end] === ")") {
              depth--;
            }
            end++;
          } while (end < length && depth > 0);
          if ("*+?".indexOf(source[end]) >= 0) {
            end++;
          }
          tokens.push({ boundary: source.slice(index, end) });
          index = end;
        } else if (char === "^" || char === "$") {
          tokens.push({ boundary: char });
          index++;
        } else {
          tokens.push({ single: char });
          index++;
        }
      }
      let out = EMPTY;
      let run = [];
      const flush = () => {
        let lastWildcard;
        run.forEach((token, at) => {
          if (token.wildcard) {
            lastWildcard = at;
          }
        });
        run.forEach((token, at) => {
          if (!token.wildcard) {
            out += token.single;
            return;
          }
          out += at === lastWildcard ? WILDCARD : `(?:(?!${separatorAfter(run, at)})[^\\/])*`;
        });
        run = [];
      };
      tokens.forEach((token) => {
        if (token.boundary === void 0) {
          run.push(token);
          return;
        }
        flush();
        out += token.boundary;
      });
      flush();
      return out;
    };
    var makeRegexPrefix = (pattern) => {
      const { source, sources } = extractBrackets(pattern);
      const replaced = REPLACERS.reduce(
        // A pass whose matcher finds nothing hands back the very string it was
        //   given, so asking first costs a search and saves a rewrite. Ten of the
        //   fifteen passes never fire for a typical .gitignore line, and between
        //   them they were 45% of this chain.
        (prev, [matcher, replacer, required]) => {
          if (matcher === DIRECT) {
            return replacer(prev, pattern);
          }
          if (required !== UNDEFINED && prev.indexOf(required) < 0) {
            return prev;
          }
          return matcher.test(prev) ? prev.replace(matcher, replacer.bind(pattern)) : prev;
        },
        source
      );
      return sources.length ? replaced.replace(
        REGEX_RESTORE_PLACEHOLDER,
        (match, index) => sources[index]
      ) : replaced;
    };
    var checkSourceOf = (body, prefix) => {
      if (body[body.length - 1] === SLASH) {
        prefix = makeRegexPrefix(body.slice(0, -1));
      }
      const head = prefix.slice(0, -1);
      const last = prefix[prefix.length - 1];
      return last === TRAILING_WILDCARD ? `${head}$` : last === TRAILING_DOUBLESTAR ? `${head}.*$` : NEVER_MATCH;
    };
    var matchesBasename = (body) => {
      const index = body.indexOf(SLASH);
      return index < 0 || index === body.length - 1;
    };
    var basenameOf = (path5) => {
      const end = path5.length - 1;
      const index = path5.lastIndexOf(
        SLASH,
        path5[end] === SLASH ? end - 1 : end
      );
      return index < 0 ? path5 : path5.slice(index + 1);
    };
    var parentOf = (path5) => {
      if (path5.charCodeAt(0) === SLASH_CODE || path5.indexOf(DOUBLE_SLASH) >= 0) {
        const slices = path5.split(SLASH).filter(Boolean);
        slices.pop();
        return slices.length ? slices.join(SLASH) + SLASH : EMPTY;
      }
      const end = path5.length - 1;
      const cut = path5.lastIndexOf(
        SLASH,
        path5.charCodeAt(end) === SLASH_CODE ? end - 1 : end
      );
      return cut < 0 ? EMPTY : path5.slice(0, cut + 1);
    };
    var isString = (subject) => typeof subject === "string";
    var checkPattern = (pattern) => pattern && isString(pattern) && !REGEX_INVALID_TRAILING_BACKSLASH.test(pattern);
    var splitPattern = (pattern) => pattern.split(REGEX_SPLITALL_CRLF).filter(Boolean);
    var IgnoreRule = class {
      constructor(pattern, mark, body, ignoreCase, negative, prefix) {
        this.pattern = pattern;
        this.mark = mark;
        this.negative = negative;
        define(this, "body", body);
        define(this, "ignoreCase", ignoreCase);
        define(this, "regexPrefix", prefix);
      }
      // Worked out on first use and kept behind an own property, the way `regex`
      //   caches itself in `_regex`. Deciding it in the constructor instead would
      //   add a fourth `defineProperty` to every rule ever built, which cost 4% of
      //   every compile -- including the compiles of rules that are never matched
      //   against anything.
      get _basenameOnly() {
        return define(this, "_basenameOnly", matchesBasename(this.body));
      }
      get regex() {
        const key = UNDERSCORE + MODE_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_IGNORE, key);
      }
      get checkRegex() {
        const key = UNDERSCORE + MODE_CHECK_IGNORE;
        if (this[key]) {
          return this[key];
        }
        return this._make(MODE_CHECK_IGNORE, key);
      }
      _make(mode, key) {
        const str = pinWildcards(
          mode === MODE_IGNORE ? this.regexPrefix.replace(REGEX_REPLACE_TRAILING_WILDCARD, replaceTrailingWildcard).replace(REGEX_REPLACE_TRAILING_DOUBLESTAR, replaceTrailingDoublestar) : checkSourceOf(this.body, this.regexPrefix)
        );
        const regex = this.ignoreCase ? new RegExp(str, "i") : new RegExp(str);
        return define(this, key, regex);
      }
    };
    var isLineEnd = (char) => char === "\r" || char === "\n";
    var trimEnd = (body) => {
      let end = body.length;
      while (end && isLineEnd(body[end - 1])) {
        end--;
      }
      const lineEnd = end;
      while (end && body[end - 1] === SPACE) {
        end--;
      }
      if (end === lineEnd) {
        return body.slice(0, end);
      }
      let backslashes = 0;
      while (backslashes < end && body[end - backslashes - 1] === ESCAPE) {
        backslashes++;
      }
      return backslashes % 2 ? body.slice(0, end - 1) + SPACE : body.slice(0, end);
    };
    var createRule = ({
      pattern,
      mark
    }, ignoreCase) => {
      let body = pattern[0] === BOM ? pattern.slice(1) : pattern;
      if (body[0] === "#") {
        return;
      }
      let negative = false;
      if (body[0] === "!") {
        negative = true;
        body = body.slice(1);
      }
      const last = body[body.length - 1];
      if (last === SPACE || last === "\r" || last === "\n") {
        body = trimEnd(body);
      }
      if (!body) {
        return;
      }
      body = body.replace(REGEX_REPLACE_LEADING_EXCAPED_EXCLAMATION, "!").replace(REGEX_REPLACE_LEADING_EXCAPED_HASH, "#");
      const regexPrefix = makeRegexPrefix(body);
      return new IgnoreRule(
        pattern,
        mark,
        body,
        ignoreCase,
        negative,
        regexPrefix
      );
    };
    var RuleManager = class {
      constructor(ignoreCase) {
        this._ignoreCase = ignoreCase;
        this._rules = [];
        this._basenameCount = 0;
      }
      _add(pattern) {
        if (pattern && pattern[KEY_IGNORE]) {
          this._rules = this._rules.concat(pattern._rules._rules);
          this._basenameCount += pattern._rules._basenameCount;
          this._added = true;
          return;
        }
        if (isString(pattern)) {
          pattern = {
            pattern
          };
        }
        const rule = checkPattern(pattern.pattern) && createRule(pattern, this._ignoreCase);
        if (rule) {
          this._added = true;
          this._rules.push(rule);
          if (matchesBasename(rule.body)) {
            this._basenameCount++;
          }
        }
      }
      // @param {Array<string> | string | Ignore} pattern
      add(pattern) {
        this._added = false;
        makeArray(
          isString(pattern) ? splitPattern(pattern) : pattern
        ).forEach(this._add, this);
        if (this._added) {
          this._literalRules = UNDEFINED;
        }
        return this._added;
      }
      // Match the literal 'abc/' for `checkIgnore`, last rule wins. Only a rule
      //   ending in a wildcard can match it (see `checkSourceOf`), so the rest
      //   are left out once, rather than tested or compiled for every path.
      testLiteral(path5) {
        const rules = this._literalRules || (this._literalRules = this._rules.filter(
          ({ body }) => body[body.length - (body[body.length - 1] === SLASH ? 2 : 1)] === "*"
        ));
        let ignored = false;
        let unignored = false;
        let matchedRule;
        for (let index = rules.length - 1; index >= 0; index--) {
          const rule = rules[index];
          if (rule.checkRegex.test(path5)) {
            ignored = !rule.negative;
            unignored = rule.negative;
            matchedRule = rule.negative ? UNDEFINED : rule;
            break;
          }
        }
        const ret = {
          ignored,
          unignored
        };
        if (matchedRule) {
          ret.rule = matchedRule;
        }
        return ret;
      }
      // Test one single path without recursively checking parent directories
      //
      // - checkUnignored `boolean` whether should check if the path is unignored,
      //   setting `checkUnignored` to `false` could reduce additional
      //   path matching.
      // - check `string` either `MODE_IGNORE` or `MODE_CHECK_IGNORE`
      // @returns {TestResult} true if a file is ignored
      test(path5, checkUnignored, mode) {
        let ignored = false;
        let unignored = false;
        let matchedRule;
        const rules = this._rules;
        const { length } = rules;
        const shortcut = this._basenameCount * 2 >= length;
        const basename = shortcut ? basenameOf(path5) : path5;
        for (let index = 0; index < length; index++) {
          const rule = rules[index];
          const { negative } = rule;
          const skip = unignored === negative && ignored !== unignored || negative && !ignored && !unignored && !checkUnignored;
          if (!skip && rule[mode].test(
            shortcut && rule._basenameOnly ? basename : path5
          )) {
            ignored = !negative;
            unignored = negative;
            matchedRule = negative ? UNDEFINED : rule;
          }
        }
        const ret = {
          ignored,
          unignored
        };
        if (matchedRule) {
          ret.rule = matchedRule;
        }
        return ret;
      }
    };
    var throwError = (message, Ctor) => {
      throw new Ctor(message);
    };
    var checkPath = (path5, originalPath, doThrow) => {
      if (!isString(path5)) {
        return doThrow(
          `path must be a string, but got \`${originalPath}\``,
          TypeError
        );
      }
      if (!path5) {
        return doThrow(`path must not be empty`, TypeError);
      }
      if (checkPath.isNotRelative(path5)) {
        const r = "`path.relative()`d";
        return doThrow(
          `path should be a ${r} string, but got "${originalPath}"`,
          RangeError
        );
      }
      return true;
    };
    var isNotRelative = (path5) => {
      const first = path5.charCodeAt(0);
      if (first === SLASH_CODE) {
        return true;
      }
      if (first !== DOT_CODE) {
        return false;
      }
      if (path5.length === 1) {
        return true;
      }
      const second = path5.charCodeAt(1);
      if (second === SLASH_CODE) {
        return true;
      }
      if (second !== DOT_CODE) {
        return false;
      }
      return path5.length === 2 || path5.charCodeAt(2) === SLASH_CODE;
    };
    checkPath.isNotRelative = isNotRelative;
    checkPath.convert = (p) => p;
    var Ignore2 = class {
      constructor({
        ignorecase = true,
        ignoreCase = ignorecase,
        allowRelativePaths = false
      } = {}) {
        define(this, KEY_IGNORE, true);
        this._rules = new RuleManager(ignoreCase);
        this._strictPathCheck = !allowRelativePaths;
        this._initCache();
      }
      _initCache() {
        this._ignoreCache = /* @__PURE__ */ Object.create(null);
        this._testCache = /* @__PURE__ */ Object.create(null);
      }
      add(pattern) {
        if (this._rules.add(pattern)) {
          this._initCache();
        }
        return this;
      }
      // legacy
      addPattern(pattern) {
        return this.add(pattern);
      }
      // @returns {TestResult}
      _test(originalPath, cache, checkUnignored) {
        const path5 = originalPath && checkPath.convert(originalPath);
        checkPath(
          path5,
          originalPath,
          this._strictPathCheck ? throwError : RETURN_FALSE
        );
        return this._t(path5, cache, checkUnignored);
      }
      checkIgnore(path5) {
        if (path5.charCodeAt(path5.length - 1) !== SLASH_CODE) {
          return this.test(path5);
        }
        const dir = this._t(path5, this._testCache, true);
        if (dir.ignored) {
          return dir;
        }
        const literal = this._rules.testLiteral(path5);
        return literal.ignored || literal.unignored ? literal : dir;
      }
      _t(path5, cache, checkUnignored) {
        if (path5 in cache) {
          return cache[path5];
        }
        const parentPath = parentOf(path5);
        const parent = parentPath ? this._t(parentPath, cache, checkUnignored) : UNDEFINED;
        return cache[path5] = parent && parent.ignored ? parent : this._rules.test(path5, checkUnignored, MODE_IGNORE);
      }
      ignores(path5) {
        return this._test(path5, this._ignoreCache, false).ignored;
      }
      createFilter() {
        return (path5) => !this.ignores(path5);
      }
      filter(paths) {
        return makeArray(paths).filter(this.createFilter());
      }
      // @returns {TestResult}
      test(path5) {
        return this._test(path5, this._testCache, true);
      }
    };
    var factory = (options) => new Ignore2(options);
    var isPathValid = (path5) => checkPath(path5 && checkPath.convert(path5), path5, RETURN_FALSE);
    var setupWindows = () => {
      const makePosix = (str) => /^\\\\\?\\/.test(str) || /["<>|\u0000-\u001F]+/u.test(str) ? str : str.replace(/\\/g, "/");
      checkPath.convert = makePosix;
      const REGEX_TEST_WINDOWS_PATH_ABSOLUTE = /^[a-z]:\//i;
      checkPath.isNotRelative = (path5) => REGEX_TEST_WINDOWS_PATH_ABSOLUTE.test(path5) || isNotRelative(path5);
    };
    if (
      // Detect `process` so that it can run in browsers.
      typeof process !== "undefined" && process.platform === "win32"
    ) {
      setupWindows();
    }
    module2.exports = factory;
    factory.default = factory;
    module2.exports.isPathValid = isPathValid;
    define(module2.exports, /* @__PURE__ */ Symbol.for("setupWindows"), setupWindows);
  }
});

// src/hooks/session-start.ts
var import_child_process3 = require("child_process");

// src/snapshot.ts
var import_fs4 = __toESM(require("fs"));
var import_path4 = __toESM(require("path"));
var import_os2 = __toESM(require("os"));
var import_crypto = __toESM(require("crypto"));
var import_child_process2 = require("child_process");
var import_ignore = __toESM(require_ignore());

// src/clone.ts
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_child_process = require("child_process");
var RANK = { clonefile: 0, cow: 1, copy: 2 };
var CLONE_NOFOLLOW = 1;
var clonefileFn;
function nativeClonefile() {
  if (clonefileFn !== void 0) return clonefileFn;
  clonefileFn = null;
  if (process.platform !== "darwin" || process.env.AGENT_UNDO_NO_FFI) return null;
  try {
    const koffi = require("koffi");
    clonefileFn = koffi.load("/usr/lib/libSystem.B.dylib").func("int clonefile(const char *src, const char *dst, uint32_t flags)");
  } catch {
  }
  return clonefileFn;
}
function copyTree(src, dst) {
  if (process.platform === "win32") {
    import_fs.default.cpSync(src, dst, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
  } else {
    (0, import_child_process.execFileSync)("cp", ["-Rp", src, dst], { stdio: "pipe" });
  }
}
function forceRemove(p) {
  try {
    import_fs.default.rmSync(p, { recursive: true, force: true });
    return;
  } catch {
  }
  const unlock = (dir) => {
    try {
      import_fs.default.chmodSync(dir, 448);
    } catch {
      return;
    }
    for (const e of import_fs.default.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) unlock(import_path.default.join(dir, e.name));
    }
  };
  if (import_fs.default.lstatSync(p).isDirectory()) unlock(p);
  import_fs.default.rmSync(p, { recursive: true, force: true });
}
function sizeOf(p) {
  const st = import_fs.default.lstatSync(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const e of import_fs.default.readdirSync(p)) total += sizeOf(import_path.default.join(p, e));
  return total;
}
function cloneEntries(from, to, entries, opts = {}) {
  import_fs.default.mkdirSync(to, { recursive: true });
  const native = nativeClonefile();
  const cowFlag = process.platform === "darwin" ? "-c" : "--reflink=always";
  let worst = "clonefile";
  let copiedBytes = 0;
  for (const name of entries) {
    const src = import_path.default.join(from, name);
    const dst = import_path.default.join(to, name);
    let mode;
    if (native && native(src, dst, CLONE_NOFOLLOW) === 0) {
      mode = "clonefile";
    } else {
      forceRemove(dst);
      try {
        if (process.platform === "win32") throw new Error("no cp");
        (0, import_child_process.execFileSync)("cp", ["-R", cowFlag, src, dst], { stdio: "pipe" });
        mode = "cow";
      } catch {
        forceRemove(dst);
        if (opts.maxCopyBytes !== void 0) {
          copiedBytes += sizeOf(src);
          if (copiedBytes > opts.maxCopyBytes) {
            throw new Error(
              `[Agent-Undo] No copy-on-write on this filesystem and the snapshot would copy over ${Math.round(opts.maxCopyBytes / 1e6)} MB. Add large dirs to .agentundoignore, or raise AGENT_UNDO_MAX_COPY_MB.`
            );
          }
        }
        copyTree(src, dst);
        mode = "copy";
      }
    }
    if (RANK[mode] > RANK[worst]) worst = mode;
  }
  return worst;
}

// src/config.ts
var import_fs2 = __toESM(require("fs"));
var import_os = __toESM(require("os"));
var import_path2 = __toESM(require("path"));
var LEVELS = ["off", "lite", "full", "paranoid"];
var DEFAULT_LEVEL = "full";
var storeHome = () => process.env.AGENT_UNDO_HOME ?? import_path2.default.join(import_os.default.homedir(), ".agent-undo");
var levelFile = () => import_path2.default.join(storeHome(), "level");
var isLevel = (v) => LEVELS.includes(v);
function readLevel() {
  const env = process.env.AGENT_UNDO_LEVEL;
  if (isLevel(env)) return env;
  try {
    const saved = import_fs2.default.readFileSync(levelFile(), "utf8").trim();
    if (isLevel(saved)) return saved;
  } catch {
  }
  return DEFAULT_LEVEL;
}
var PROJECT_MARKERS = [".git", ".agentundoignore", "package.json", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "Gemfile", "pom.xml", "build.gradle", "composer.json", "deno.json"];
var isProjectDir = (dir) => PROJECT_MARKERS.some((m) => import_fs2.default.existsSync(import_path2.default.join(dir, m)));

// src/stats.ts
var import_fs3 = __toESM(require("fs"));
var import_path3 = __toESM(require("path"));
var file = () => import_path3.default.join(storeHome(), "stats.json");
var empty = () => ({ snapshots: 0, byTrigger: {}, snapshotMsTotal: 0, reverts: 0, partialReverts: 0, pathsRestored: 0, since: (/* @__PURE__ */ new Date()).toISOString() });
function readStats() {
  try {
    return { ...empty(), ...JSON.parse(import_fs3.default.readFileSync(file(), "utf8")) };
  } catch {
    return empty();
  }
}
function recordStats(update) {
  try {
    const s = readStats();
    update(s);
    import_fs3.default.mkdirSync(storeHome(), { recursive: true });
    const tmp = `${file()}.${process.pid}`;
    import_fs3.default.writeFileSync(tmp, JSON.stringify(s, null, 2));
    import_fs3.default.renameSync(tmp, file());
  } catch {
  }
}

// src/snapshot.ts
var IGNORE_FILE = ".agentundoignore";
var KEEP_DEFAULT = 10;
var MAX_SLUG = 80;
var LOCK_STALE_MS = 10 * 6e4;
var maxCopyBytes = () => Number(process.env.AGENT_UNDO_MAX_COPY_MB ?? 1024) * 1e6;
function realDir(dir) {
  const resolved = import_path4.default.resolve(dir);
  try {
    return import_fs4.default.realpathSync(resolved);
  } catch {
    return resolved;
  }
}
function snapshotBase(projectDir2 = process.cwd()) {
  const hash = import_crypto.default.createHash("md5").update(realDir(projectDir2)).digest("hex");
  return import_path4.default.join(storeHome(), "snapshots", hash);
}
var dataDir = (base, id) => import_path4.default.join(base, id, "data");
var metaFile = (base, id) => import_path4.default.join(base, id, "meta.json");
function assertSafeTarget(dir) {
  const resolved = realDir(dir);
  const forbidden = [import_path4.default.parse(resolved).root, realDir(import_os2.default.homedir())];
  if (forbidden.includes(resolved)) {
    throw new Error(`[Agent-Undo] Refusing to operate on ${resolved}: run it inside a project directory.`);
  }
}
var BusyError = class extends Error {
};
function withLock(sourceDir, fn) {
  const base = snapshotBase(sourceDir);
  import_fs4.default.mkdirSync(base, { recursive: true });
  const lock = import_path4.default.join(base, ".lock");
  for (let attempt = 0; ; attempt++) {
    try {
      import_fs4.default.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
      break;
    } catch (e) {
      if (e.code !== "EEXIST" || attempt > 0) throw new BusyError("[Agent-Undo] Another snapshot or revert is running for this directory.");
      let stale = true;
      try {
        const { pid, at } = JSON.parse(import_fs4.default.readFileSync(lock, "utf8"));
        try {
          process.kill(pid, 0);
        } catch (k) {
          if (k.code !== "EPERM") throw k;
        }
        stale = Date.now() - at > LOCK_STALE_MS;
      } catch {
      }
      if (!stale) throw new BusyError("[Agent-Undo] Another snapshot or revert is running for this directory.");
      import_fs4.default.rmSync(lock, { force: true });
    }
  }
  try {
    return fn();
  } finally {
    import_fs4.default.rmSync(lock, { force: true });
  }
}
function loadIgnore(sourceDir) {
  try {
    return (0, import_ignore.default)().add(import_fs4.default.readFileSync(import_path4.default.join(sourceDir, IGNORE_FILE), "utf8"));
  } catch {
    return null;
  }
}
var posix = (p) => p.split(import_path4.default.sep).join("/");
function findIgnored(root, ig, rel = "") {
  if (!ig) return [];
  const out = [];
  for (const e of import_fs4.default.readdirSync(import_path4.default.join(root, rel), { withFileTypes: true })) {
    const r = import_path4.default.join(rel, e.name);
    if (r === ".git") continue;
    if (ig.ignores(posix(r) + (e.isDirectory() ? "/" : ""))) out.push(r);
    else if (e.isDirectory()) out.push(...findIgnored(root, ig, r));
  }
  return out;
}
function discard(base, ids) {
  if (ids.length === 0) return;
  for (const id of ids) {
    try {
      import_fs4.default.renameSync(import_path4.default.join(base, id), import_path4.default.join(base, `.trash-${id}`));
    } catch {
    }
  }
  const trash = import_fs4.default.readdirSync(base).filter((f) => f.startsWith(".trash-")).map((f) => import_path4.default.join(base, f));
  const removeNow = () => {
    for (const t of trash) import_fs4.default.rmSync(t, { recursive: true, force: true });
  };
  if (process.env.AGENT_UNDO_SYNC_DELETE) return removeNow();
  try {
    (0, import_child_process2.spawn)(process.execPath, ["-e", 'for (const p of process.argv.slice(1)) require("fs").rmSync(p, { recursive: true, force: true })', ...trash], {
      detached: true,
      stdio: "ignore"
    }).unref();
  } catch {
    removeNow();
  }
}
function claimId(base, name) {
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const slug = name ? "-" + name.replace(/[^\w-]+/g, "_").slice(0, MAX_SLUG) : "";
  const stamp = createdAt.replace(/[:.]/g, "-");
  let id = stamp + slug;
  for (let n = 1; ; n++) {
    try {
      import_fs4.default.mkdirSync(import_path4.default.join(base, id));
      return { id, createdAt };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      id = `${stamp}.${n}${slug}`;
    }
  }
}
function snapshotUnlocked(sourceDir, opts) {
  const base = snapshotBase(sourceDir);
  const { id, createdAt } = claimId(base, opts.name);
  const data = dataDir(base, id);
  const start = Date.now();
  const ignored = findIgnored(sourceDir, loadIgnore(sourceDir));
  const topIgnored = new Set(ignored.filter((r) => !r.includes(import_path4.default.sep)));
  const entries = import_fs4.default.readdirSync(sourceDir).filter((e) => e !== ".git" && !topIgnored.has(e));
  let mode;
  try {
    mode = cloneEntries(sourceDir, data, entries, { maxCopyBytes: maxCopyBytes() });
  } catch (e) {
    forceRemove(import_path4.default.join(base, id));
    throw e;
  }
  for (const r of ignored) if (!topIgnored.has(r)) import_fs4.default.rmSync(import_path4.default.join(data, r), { recursive: true, force: true });
  const meta = {
    id,
    name: opts.name,
    createdAt,
    source: realDir(sourceDir),
    mode,
    elapsedMs: Date.now() - start,
    reason: opts.reason,
    trigger: opts.trigger ?? "manual"
  };
  import_fs4.default.writeFileSync(metaFile(base, id), JSON.stringify(meta, null, 2));
  recordStats((st) => {
    st.snapshots++;
    st.byTrigger[meta.trigger] = (st.byTrigger[meta.trigger] ?? 0) + 1;
    st.snapshotMsTotal += meta.elapsedMs;
  });
  pruneSnapshots(sourceDir, opts.keep ?? KEEP_DEFAULT);
  return meta;
}
function takeSnapshot(sourceDir, opts = {}) {
  assertSafeTarget(sourceDir);
  return withLock(sourceDir, () => snapshotUnlocked(sourceDir, opts));
}
function listSnapshots(sourceDir) {
  const base = snapshotBase(sourceDir);
  if (!import_fs4.default.existsSync(base)) return [];
  return import_fs4.default.readdirSync(base).filter((id) => !id.startsWith(".")).sort().flatMap((id) => {
    try {
      return [JSON.parse(import_fs4.default.readFileSync(metaFile(base, id), "utf8"))];
    } catch {
      return [];
    }
  });
}
function pruneSnapshots(sourceDir, keep = KEEP_DEFAULT) {
  const base = snapshotBase(sourceDir);
  const all = listSnapshots(sourceDir);
  const baseline = all.filter((s) => s.trigger === "session").at(-1);
  const prunable = all.filter((s) => !s.name && s !== baseline);
  const drop = prunable.slice(0, Math.max(0, prunable.length - keep));
  discard(base, drop.map((s) => s.id));
  return drop.length;
}

// src/instructions.ts
var CORE_RULES = [
  "Snapshot before danger: before dependency installs/removals, migrations, bulk deletes, codegen or large refactors, call `take_snapshot` with a descriptive `name`.",
  "Revert in two steps: a revert discards everything changed since the snapshot, including legitimate work and edits the user made meanwhile. `revert_environment` without `confirm` reverts nothing: it lists every path it would undo and returns a `confirm_token`. Read that list, then call again with the same arguments plus `confirm`.",
  "Prefer a partial revert: if only some files are broken, pass `paths` to `revert_environment` and keep the rest.",
  `Ask before reverting changes that are not yours: if the preview lists files you did not change, or that the user's request does not account for, do not confirm. Name those files and ask the user. "Roll it back" is not consent to discard work nobody mentioned.`,
  "Revert instead of thrashing: if an attempt broke the build and two fixes have not worked, revert to the last good snapshot and try a different approach.",
  "Reverts are undoable: each revert saves a `pre-revert` snapshot; its id is in the tool result.",
  "Report plainly: after reverting, say what was undone and what you will try next.",
  "Know the boundary: snapshots cover only the project directory. They cannot undo pushes, deploys, remote or production databases, sent messages or global installs, and a snapshot taken first does not make those safe. Before one, say so and ask the user, even if they say agent-undo has it covered; at full and paranoid levels the hook also makes Claude Code ask before force-pushes, deploys and production database commands."
];
var LEVEL_NOTES = {
  lite: "Level LITE: no automatic snapshots. Snapshot only when the user asks or right before an operation you cannot undo with git.",
  full: "Level FULL (default): a baseline snapshot is taken at session start and risky shell commands are auto-snapshotted. You still snapshot before risky file edits and refactors.",
  paranoid: "Level PARANOID: a checkpoint is taken on every user turn. Never confirm a revert, even of your own changes, until the user has seen the preview and said yes: show it and end your turn with the question."
};
function getInstructions(level) {
  if (level === "off") return "AGENT-UNDO OFF. Do not take snapshots or revert unless the user explicitly asks.";
  return [
    `AGENT-UNDO ACTIVE (${level}). You can snapshot and roll back this project, including untracked files and node_modules, with the agent-undo MCP tools: take_snapshot, list_snapshots, diff_snapshot, revert_environment, undo_status.`,
    LEVEL_NOTES[level],
    ...CORE_RULES.map((r, i) => `${i + 1}. ${r}`),
    "The top-level .git and paths in .agentundoignore are never snapshotted or touched. Switch level: /agent-undo lite|full|paranoid|off."
  ].join("\n");
}
var STATIC_BODY = [
  "# agent-undo",
  "",
  "You can snapshot and roll back this project with agent-undo: copy-on-write clones of the whole directory, including untracked files, `node_modules`, build output and local databases. Snapshots take milliseconds and cost almost no disk, so take them freely.",
  "",
  "Use the agent-undo MCP tools: `take_snapshot(name?)`, `list_snapshots`, `diff_snapshot(snapshot?)`, `revert_environment(snapshot?, paths?, confirm?)`, `undo_status`. Every tool takes an optional `project_dir`; pass the project's absolute path. Without the MCP server, the same operations are a CLI: `agent-undo snapshot <name>`, `agent-undo list`, `agent-undo diff [snap]`, `agent-undo revert [snap] --yes [--only <paths...>]`.",
  "",
  "## Rules",
  "",
  ...CORE_RULES.map((r, i) => `${i + 1}. ${r}`),
  "",
  "## Limits",
  "",
  "Snapshots cover the project directory only. They cannot undo pushes, deploys, remote or Docker-hosted databases, sent messages, global installs or files outside the project: say so and ask before any of those. A revert through the MCP server is two-step (preview, then `confirm`); the CLI previews unless given `--yes`. The top-level `.git` and paths in `.agentundoignore` are never snapshotted or touched, so a revert never rewrites git history."
].join("\n");

// src/hooks/common.ts
var PLATFORMS = ["claude", "codex", "cursor", "gemini"];
function detectPlatform(argv = process.argv, env = process.env) {
  const i = argv.indexOf("--platform");
  const named = i >= 0 ? argv[i + 1] : void 0;
  if (PLATFORMS.includes(named)) return named;
  if (env.PLUGIN_DATA) return "codex";
  if (env.CURSOR_VERSION) return "cursor";
  return "claude";
}
var platform = detectPlatform();
function formatOutput(p, event, context = "") {
  if (p === "cursor") {
    if (context) return JSON.stringify({ additional_context: context, ...event === "UserPromptSubmit" && { continue: true } });
    return event === "PreToolUse" ? JSON.stringify({ agent_message: "" }) : "";
  }
  if (context) return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } });
  if (p === "codex") return JSON.stringify(event === "PreToolUse" ? { hookSpecificOutput: { hookEventName: event } } : {});
  return "";
}
var emitted = false;
function emitContext(event, context) {
  emitted = true;
  process.stdout.write(formatOutput(platform, event, context));
}
var projectDir = (input) => input.cwd || input.workspace_roots?.[0] || process.env.CURSOR_PROJECT_DIR || process.env.GEMINI_PROJECT_DIR || process.cwd();
function readInput() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => raw += c);
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(raw.replace(/^﻿/, "")));
      } catch {
        resolve({});
      }
    });
  });
}
function runHook(event, body) {
  readInput().then(body).catch(() => {
  }).finally(() => {
    if (!emitted) process.stdout.write(formatOutput(platform, event));
    process.exit(0);
  });
}
var lastSnapshotAgeMs = (snaps) => snaps.length ? Date.now() - Date.parse(snaps[snaps.length - 1].createdAt) : Infinity;

// src/hooks/session-start.ts
var BASELINE_THROTTLE_MS = 5 * 6e4;
if (process.argv[2] === "--baseline") {
  try {
    takeSnapshot(process.argv[3], { reason: "session start baseline", trigger: "session" });
  } catch {
  }
} else {
  runHook("SessionStart", (input) => {
    const level = readLevel();
    if (level === "off") return;
    const cwd = projectDir(input);
    const project = isProjectDir(cwd);
    const snaps = project ? listSnapshots(cwd) : [];
    const fresh = !input.source || input.source === "startup" || input.source === "clear";
    let note = project ? `${snaps.length} snapshot(s) exist for this project.` : "Not a project directory: automatic snapshots are disabled here.";
    if (project && level !== "lite" && fresh && lastSnapshotAgeMs(snaps) > BASELINE_THROTTLE_MS) {
      (0, import_child_process3.spawn)(process.execPath, [__filename, "--baseline", cwd], { detached: true, stdio: "ignore" }).unref();
      note += " A baseline snapshot of the session start is being taken now.";
    }
    if (platform !== "claude") note += ` Project directory: ${cwd} (pass it as project_dir to the agent-undo tools).`;
    emitContext("SessionStart", `${getInstructions(level)}
${note}`);
  });
}
