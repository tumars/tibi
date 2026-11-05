// 由 scripts/build-samples.mjs 从 samples/*/ 生成，不要手改。
import type { SampleBody } from '../samples.js';

const body: SampleBody = {
  "markdown": "You write code as a story for other people. The compiler reads it as a long, flat string of characters. Everything a compiler does is an attempt to recover the structure that you had in mind, check that it makes sense, and then translate it into something a machine can execute. This article walks through those stages using one tiny function.\n\n```rust\nfn area(width: u32, height: u32) -> u32 {\n    let result = width * height;\n    result\n}\n```\n\n## Lexing: from characters to tokens\n\nThe first stage is lexical analysis, usually called lexing. The lexer scans the source text from left to right and groups characters into tokens. A token is the smallest unit that carries meaning: a keyword such as `fn`, an identifier such as `width`, a symbol such as `->`, or a literal number. Whitespace and comments are typically discarded at this point, because they matter to humans but not to the grammar.\n\nLexing sounds trivial, but it has to resolve some ambiguity. When the lexer sees `-` followed by `>`, it must decide whether these are two separate operators or a single arrow. Most lexers follow the rule of the longest match: keep consuming characters as long as the result is still a valid token.\n\n## Parsing: from tokens to a tree\n\nA flat list of tokens still has no shape. The parser takes the tokens and checks them against the grammar of the language, building an abstract syntax tree, or AST. In the tree, the function is a node with children for its name, its parameters, its return type and its body. The expression `width * height` becomes a multiplication node with two leaves.\n\nThe tree is called abstract because it leaves out details that only existed to make the text readable. Parentheses, for example, disappear once their job is done: their only purpose was to tell the parser how to group things, and the shape of the tree now records that grouping explicitly.\n\nIf the tokens do not fit the grammar, this is where you get a syntax error. Good parsers try to recover after an error and keep going, so that one missing semicolon does not hide every other mistake in the file.\n\n## Semantic analysis: does it make sense?\n\nA program can be grammatically correct and still be nonsense. Semantic analysis walks the tree and asks harder questions. Does every name refer to something that has been declared? Are the types compatible? Is a value used after it has been moved somewhere else?\n\nIn our example, the checker confirms that `width` and `height` are both `u32`, that multiplying them produces a `u32`, and that the function returns the type it promised. This is also the stage where languages like Rust enforce ownership and borrowing rules. The errors you see here are often the most valuable ones, because they describe mistakes that would otherwise surface as bugs at runtime.\n\n## Intermediate representation\n\nOnce the program is known to be valid, most compilers lower the tree into an intermediate representation, or IR. An IR is simpler and more uniform than the source language. Loops, conditionals and method calls are reduced to a small set of primitive operations and explicit jumps between blocks.\n\nThe point of an IR is to decouple the front end of the compiler from the back end. Many languages can share the same IR, and the same IR can be translated for many processors. This is why a single toolchain can support several languages and several kinds of hardware without writing every combination by hand.\n\n## Optimization\n\nWorking on the IR, the optimizer tries to produce a program that behaves identically but runs faster or uses less memory. It might notice that `result` is assigned once and immediately returned, and remove the variable altogether. It might evaluate `2 * 8` at compile time instead of at runtime, a technique known as constant folding. It might inline a small function so that the overhead of calling it disappears.\n\nOptimizations must be conservative. The compiler is only allowed to change how the program works, never what it does. That guarantee is what makes it safe to turn optimizations on without rereading your own code.\n\n## Code generation\n\nThe final stage turns the optimized IR into instructions for a specific processor. The code generator chooses which instructions to use, assigns values to a limited number of registers, and decides what has to spill into memory. The output is an object file, which a linker then combines with libraries to produce an executable.\n\n## Why this matters to you\n\nYou do not need to write a compiler to benefit from knowing how one works. Error messages become easier to read once you can tell whether they come from the parser or from the type checker. Performance advice makes more sense when you know what the optimizer can and cannot see. And the next time a build takes too long, you will have a rough idea of where the time might be going.",
  "ai": {
    "summary": "文章用一个很小的 Rust 函数，按顺序讲编译器怎么处理代码：词法分析把字符切成 token；语法分析按语法规则建出抽象语法树（AST）；语义分析检查名字、类型和所有权是否说得通；然后降成更简单统一的中间表示（IR），让前端和后端解耦；优化器在不改变程序行为的前提下让它更快更省；最后代码生成产出机器指令，再由链接器生成可执行文件。了解这些阶段，能帮你看懂报错、理解性能建议。",
    "advice": "技术文章的生词大多是术语（lexer、parser、IR），它们在文中都有解释，读的时候先抓“这一阶段输入什么、输出什么”。值得记的是通用的学术动词：resolve、enforce、decouple、surface、spill，它们在其他技术文档里也很常见。",
    "phrases": [
      {
        "text": "walk through",
        "zh": "逐步讲解"
      },
      {
        "text": "make sense",
        "zh": "说得通，合乎逻辑"
      },
      {
        "text": "refer to",
        "zh": "指向，指代"
      },
      {
        "text": "at compile time",
        "zh": "在编译时（相对于 at runtime 运行时）"
      },
      {
        "text": "turn on",
        "zh": "打开（选项、开关）"
      },
      {
        "text": "a rough idea",
        "zh": "大致的概念"
      }
    ],
    "hard_sentences": [
      {
        "s": "Everything a compiler does is an attempt to recover the structure that you had in mind, check that it makes sense, and then translate it into something a machine can execute.",
        "zh": "编译器做的一切，都是在设法还原你心里的结构，检查它说不说得通，再把它翻译成机器能执行的东西。主干是 Everything … is an attempt to do A, B, and then C。"
      },
      {
        "s": "Parentheses, for example, disappear once their job is done: their only purpose was to tell the parser how to group things, and the shape of the tree now records that grouping explicitly.",
        "zh": "比如括号，完成任务后就消失了：它们唯一的作用是告诉解析器怎么分组，而现在树的形状已经明确记下了这种分组。"
      }
    ],
    "context_meanings": {
      "compiler": "编译器",
      "execute": "执行（程序）",
      "lexical": "词法的",
      "lexing": "词法分析",
      "lexer": "词法分析器",
      "token": "词法单元（token）",
      "keyword": "关键字",
      "identifier": "标识符（变量名、函数名等）",
      "literal": "字面量（直接写出的值）",
      "discard": "丢弃",
      "grammar": "（编程语言的）语法规则",
      "trivial": "很简单的，微不足道的",
      "resolve": "消除，解决（歧义）",
      "ambiguity": "歧义",
      "operator": "运算符",
      "consume": "读入（字符）",
      "parser": "语法分析器",
      "parse": "解析",
      "abstract": "抽象的（语法树）",
      "syntax": "语法",
      "multiplication": "乘法",
      "parenthesis": "圆括号",
      "explicitly": "明确地",
      "semicolon": "分号",
      "semantic": "语义的",
      "grammatically": "在语法上",
      "nonsense": "说不通的东西",
      "declare": "声明（变量）",
      "compatible": "（类型）兼容的",
      "enforce": "强制执行（规则）",
      "ownership": "所有权（Rust 的内存管理规则）",
      "borrow": "借用（Rust 里不取得所有权地使用值）",
      "surface": "暴露出来，浮现",
      "runtime": "运行时",
      "lower": "把（高层结构）降为更底层的表示",
      "intermediate": "中间的",
      "representation": "表示形式",
      "uniform": "统一的，一致的",
      "conditional": "条件语句",
      "primitive": "基本的，原始的",
      "decouple": "解耦，使分开",
      "toolchain": "工具链",
      "optimization": "优化",
      "optimizer": "优化器",
      "identically": "完全相同地",
      "altogether": "完全，彻底",
      "inline": "内联（把函数体直接展开到调用处）",
      "overhead": "额外开销",
      "conservative": "保守的，稳妥的",
      "guarantee": "保证",
      "register": "寄存器",
      "spill": "（寄存器不够时）溢出到内存",
      "linker": "链接器",
      "executable": "可执行文件",
      "folding": "constant folding：常量折叠"
    }
  }
};
export default body;
