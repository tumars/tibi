// 由 scripts/build-samples.mjs 从 samples/*/ 生成，不要手改。
import type { SampleDef } from './samples.js';

export const SAMPLE_DEFS: SampleDef[] = [
  {
    "id": "how-a-compiler-sees-your-code",
    "title": "How a Compiler Sees Your Code",
    "author": "Tibi",
    "genre": "tech",
    "source": "Tibi 自拟示例（MIT）",
    "is_default": true,
    "order": 1,
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
  },
  {
    "id": "gift-of-the-magi",
    "title": "The Gift of the Magi",
    "author": "O. Henry",
    "genre": "lit",
    "source": "Project Gutenberg 电子书 #7256（1905，公有领域）",
    "is_default": false,
    "order": 2,
    "markdown": "One dollar and eighty-seven cents. That was all. And sixty cents of it was in pennies. Pennies saved one and two at a time by bulldozing the grocer and the vegetable man and the butcher until one’s cheeks burned with the silent imputation of parsimony that such close dealing implied. Three times Della counted it. One dollar and eighty-seven cents. And the next day would be Christmas.\n\nThere was clearly nothing to do but flop down on the shabby little couch and howl. So Della did it. Which instigates the moral reflection that life is made up of sobs, sniffles, and smiles, with sniffles predominating.\n\nWhile the mistress of the home is gradually subsiding from the first stage to the second, take a look at the home. A furnished flat at $8 per week. It did not exactly beggar description, but it certainly had that word on the lookout for the mendicancy squad.\n\nIn the vestibule below was a letter-box into which no letter would go, and an electric button from which no mortal finger could coax a ring. Also appertaining thereunto was a card bearing the name “Mr. James Dillingham Young.”\n\nThe “Dillingham” had been flung to the breeze during a former period of prosperity when its possessor was being paid $30 per week. Now, when the income was shrunk to $20, though, they were thinking seriously of contracting to a modest and unassuming D. But whenever Mr. James Dillingham Young came home and reached his flat above he was called “Jim” and greatly hugged by Mrs. James Dillingham Young, already introduced to you as Della. Which is all very good.\n\nDella finished her cry and attended to her cheeks with the powder rag. She stood by the window and looked out dully at a gray cat walking a gray fence in a gray backyard. Tomorrow would be Christmas Day, and she had only $1.87 with which to buy Jim a present. She had been saving every penny she could for months, with this result. Twenty dollars a week doesn’t go far. Expenses had been greater than she had calculated. They always are. Only $1.87 to buy a present for Jim. Her Jim. Many a happy hour she had spent planning for something nice for him. Something fine and rare and sterling—something just a little bit near to being worthy of the honor of being owned by Jim.\n\nThere was a pier glass between the windows of the room. Perhaps you have seen a pier glass in an $8 flat. A very thin and very agile person may, by observing his reflection in a rapid sequence of longitudinal strips, obtain a fairly accurate conception of his looks. Della, being slender, had mastered the art.\n\nSuddenly she whirled from the window and stood before the glass. Her eyes were shining brilliantly, but her face had lost its color within twenty seconds. Rapidly she pulled down her hair and let it fall to its full length.\n\nNow, there were two possessions of the James Dillingham Youngs in which they both took a mighty pride. One was Jim’s gold watch that had been his father’s and his grandfather’s. The other was Della’s hair. Had the queen of Sheba lived in the flat across the airshaft, Della would have let her hair hang out the window some day to dry just to depreciate Her Majesty’s jewels and gifts. Had King Solomon been the janitor, with all his treasures piled up in the basement, Jim would have pulled out his watch every time he passed, just to see him pluck at his beard from envy.\n\nSo now Della’s beautiful hair fell about her rippling and shining like a cascade of brown waters. It reached below her knee and made itself almost a garment for her. And then she did it up again nervously and quickly. Once she faltered for a minute and stood still while a tear or two splashed on the worn red carpet.\n\nOn went her old brown jacket; on went her old brown hat. With a whirl of skirts and with the brilliant sparkle still in her eyes, she fluttered out the door and down the stairs to the street.\n\nWhere she stopped the sign read: “Mme. Sofronie. Hair Goods of All Kinds.” One flight up Della ran, and collected herself, panting. Madame, large, too white, chilly, hardly looked the “Sofronie.”\n\n“Will you buy my hair?” asked Della.\n\n“I buy hair,” said Madame. “Take yer hat off and let’s have a sight at the looks of it.”\n\nDown rippled the brown cascade.\n\n“Twenty dollars,” said Madame, lifting the mass with a practised hand.\n\n“Give it to me quick,” said Della.\n\nOh, and the next two hours tripped by on rosy wings. Forget the hashed metaphor. She was ransacking the stores for Jim’s present.\n\nShe found it at last. It surely had been made for Jim and no one else. There was no other like it in any of the stores, and she had turned all of them inside out. It was a platinum fob chain simple and chaste in design, properly proclaiming its value by substance alone and not by meretricious ornamentation—as all good things should do. It was even worthy of The Watch. As soon as she saw it she knew that it must be Jim’s. It was like him. Quietness and value—the description applied to both. Twenty-one dollars they took from her for it, and she hurried home with the 87 cents. With that chain on his watch Jim might be properly anxious about the time in any company. Grand as the watch was, he sometimes looked at it on the sly on account of the old leather strap that he used in place of a chain.\n\nWhen Della reached home her intoxication gave way a little to prudence and reason. She got out her curling irons and lighted the gas and went to work repairing the ravages made by generosity added to love. Which is always a tremendous task, dear friends—a mammoth task.\n\nWithin forty minutes her head was covered with tiny, close-lying curls that made her look wonderfully like a truant schoolboy. She looked at her reflection in the mirror long, carefully, and critically.\n\n“If Jim doesn’t kill me,” she said to herself, “before he takes a second look at me, he’ll say I look like a Coney Island chorus girl. But what could I do—oh! what could I do with a dollar and eighty-seven cents?”\n\nAt 7 o’clock the coffee was made and the frying-pan was on the back of the stove hot and ready to cook the chops.\n\nJim was never late. Della doubled the fob chain in her hand and sat on the corner of the table near the door that he always entered. Then she heard his step on the stair away down on the first flight, and she turned white for just a moment. She had a habit of saying a little silent prayer about the simplest everyday things, and now she whispered: “Please God, make him think I am still pretty.”\n\nThe door opened and Jim stepped in and closed it. He looked thin and very serious. Poor fellow, he was only twenty-two—and to be burdened with a family! He needed a new overcoat and he was without gloves.\n\nJim stopped inside the door, as immovable as a setter at the scent of quail. His eyes were fixed upon Della, and there was an expression in them that she could not read, and it terrified her. It was not anger, nor surprise, nor disapproval, nor horror, nor any of the sentiments that she had been prepared for. He simply stared at her fixedly with that peculiar expression on his face.\n\nDella wriggled off the table and went for him.\n\n“Jim, darling,” she cried, “don’t look at me that way. I had my hair cut off and sold because I couldn’t have lived through Christmas without giving you a present. It’ll grow out again—you won’t mind, will you? I just had to do it. My hair grows awfully fast. Say ‘Merry Christmas!’ Jim, and let’s be happy. You don’t know what a nice—what a beautiful, nice gift I’ve got for you.”\n\n“You’ve cut off your hair?” asked Jim, laboriously, as if he had not arrived at that patent fact yet even after the hardest mental labor.\n\n“Cut it off and sold it,” said Della. “Don’t you like me just as well, anyhow? I’m me without my hair, ain’t I?”\n\nJim looked about the room curiously.\n\n“You say your hair is gone?” he said, with an air almost of idiocy.\n\n“You needn’t look for it,” said Della. “It’s sold, I tell you—sold and gone, too. It’s Christmas Eve, boy. Be good to me, for it went for you. Maybe the hairs of my head were numbered,” she went on with sudden serious sweetness, “but nobody could ever count my love for you. Shall I put the chops on, Jim?”\n\nOut of his trance Jim seemed quickly to wake. He enfolded his Della. For ten seconds let us regard with discreet scrutiny some inconsequential object in the other direction. Eight dollars a week or a million a year—what is the difference? A mathematician or a wit would give you the wrong answer. The magi brought valuable gifts, but that was not among them. This dark assertion will be illuminated later on.\n\nJim drew a package from his overcoat pocket and threw it upon the table.\n\n“Don’t make any mistake, Dell,” he said, “about me. I don’t think there’s anything in the way of a haircut or a shave or a shampoo that could make me like my girl any less. But if you’ll unwrap that package you may see why you had me going a while at first.”\n\nWhite fingers and nimble tore at the string and paper. And then an ecstatic scream of joy; and then, alas! a quick feminine change to hysterical tears and wails, necessitating the immediate employment of all the comforting powers of the lord of the flat.\n\nFor there lay The Combs—the set of combs, side and back, that Della had worshipped long in a Broadway window. Beautiful combs, pure tortoise shell, with jewelled rims—just the shade to wear in the beautiful vanished hair. They were expensive combs, she knew, and her heart had simply craved and yearned over them without the least hope of possession. And now, they were hers, but the tresses that should have adorned the coveted adornments were gone.\n\nBut she hugged them to her bosom, and at length she was able to look up with dim eyes and a smile and say: “My hair grows so fast, Jim!”\n\nAnd then Della leaped up like a little singed cat and cried, “Oh, oh!”\n\nJim had not yet seen his beautiful present. She held it out to him eagerly upon her open palm. The dull precious metal seemed to flash with a reflection of her bright and ardent spirit.\n\n“Isn’t it a dandy, Jim? I hunted all over town to find it. You’ll have to look at the time a hundred times a day now. Give me your watch. I want to see how it looks on it.”\n\nInstead of obeying, Jim tumbled down on the couch and put his hands under the back of his head and smiled.\n\n“Dell,” said he, “let’s put our Christmas presents away and keep ’em a while. They’re too nice to use just at present. I sold the watch to get the money to buy your combs. And now suppose you put the chops on.”\n\nThe magi, as you know, were wise men—wonderfully wise men—who brought gifts to the Babe in the manger. They invented the art of giving Christmas presents. Being wise, their gifts were no doubt wise ones, possibly bearing the privilege of exchange in case of duplication. And here I have lamely related to you the uneventful chronicle of two foolish children in a flat who most unwisely sacrificed for each other the greatest treasures of their house. But in a last word to the wise of these days let it be said that of all who give gifts these two were the wisest. Of all who give and receive gifts, such as they are wisest. Everywhere they are wisest. They are the magi.",
    "ai": {
      "summary": "圣诞节前一天，德拉只攒下 1 美元 87 美分，买不起像样的礼物送给丈夫吉姆。她把自己引以为傲的长发卖了 20 美元，给吉姆祖传的金表配了一条白金表链。吉姆回到家才说出：他已经卖掉金表，给德拉买了一套她盼了很久的玳瑁发梳。两件礼物都用不上了，作者却说，这两个“傻孩子”才是最懂送礼的人，就是故事里的“麦琪”。",
      "advice": "这篇的生词集中在作者的旁白里（parsimony、mendicancy、meretricious 这类大词），多是故意用来制造幽默的书面语，认识大意即可，不必都记。对话部分很口语，适合留意 had me going、take a look、put away 这类短语。",
      "phrases": [
        {
          "text": "flop down",
          "zh": "一下子瘫坐、扑倒（在沙发上）"
        },
        {
          "text": "beggar description",
          "zh": "难以形容（这里作者故意拿 beggar 的“乞丐”义开玩笑）"
        },
        {
          "text": "go far",
          "zh": "（钱）经花、够用；doesn't go far 就是不经花"
        },
        {
          "text": "take pride in",
          "zh": "为……感到自豪"
        },
        {
          "text": "on the sly",
          "zh": "偷偷地"
        },
        {
          "text": "give way to",
          "zh": "让位于，被……取代"
        },
        {
          "text": "had me going",
          "zh": "让我一时摸不着头脑、被唬住"
        },
        {
          "text": "at length",
          "zh": "终于，过了好一会儿"
        }
      ],
      "hard_sentences": [
        {
          "s": "Pennies saved one and two at a time by bulldozing the grocer and the vegetable man and the butcher until one’s cheeks burned with the silent imputation of parsimony that such close dealing implied.",
          "zh": "这些硬币是一分两分地攒下来的：跟杂货商、菜贩和肉铺老板软磨硬泡地砍价，直到砍得脸上发烧，因为这样斤斤计较，别人虽不说，也会觉得你小气。"
        },
        {
          "s": "A very thin and very agile person may, by observing his reflection in a rapid sequence of longitudinal strips, obtain a fairly accurate conception of his looks.",
          "zh": "一个又瘦又灵活的人，通过快速移动、在这面窄镜子里一条一条地看自己的影子，才能大致知道自己长什么样。（作者在调侃镜子太窄。）"
        }
      ],
      "context_meanings": {
        "bulldoze": "（跟店主）软磨硬泡地砍价",
        "imputation": "（别人心里的）指责、暗中的看法",
        "parsimony": "吝啬，小气",
        "shabby": "破旧的",
        "howl": "放声大哭",
        "instigate": "引发（一种感想）",
        "sniffle": "抽鼻子，抽泣",
        "predominate": "占多数",
        "subside": "（情绪）渐渐平息",
        "beggar": "使……难以（形容）；作者借“乞丐”义开玩笑",
        "mendicancy": "行乞；mendicancy squad 指专抓乞丐的巡查队，暗指这屋子穷得像乞丐住的",
        "vestibule": "门厅，楼下的门道",
        "appertain": "附属于，属于（古旧用法）",
        "thereunto": "（附属）于此（古旧用法）",
        "prosperity": "（手头）宽裕的时候",
        "unassuming": "不张扬的，朴素的",
        "sterling": "纯正的，货真价实的",
        "pier": "pier glass：两窗之间的狭长穿衣镜",
        "agile": "灵活的",
        "longitudinal": "纵向的，竖条的",
        "conception": "（对自己样子的）大致印象",
        "slender": "苗条的",
        "whirl": "猛地转身",
        "depreciate": "使……相形见绌，贬低",
        "janitor": "（楼房的）看门人，管理员",
        "envy": "嫉妒",
        "ripple": "（头发）像水波一样起伏",
        "cascade": "瀑布（形容披下来的长发）",
        "garment": "衣服（头发长得几乎能当衣服）",
        "falter": "犹豫，迟疑",
        "flutter": "轻快地跑（出门）",
        "pant": "喘气",
        "metaphor": "比喻",
        "ransack": "翻遍（各家商店）",
        "fob": "fob chain：怀表链",
        "chaste": "（设计）简洁朴素的",
        "proclaim": "显示出，彰显",
        "meretricious": "华而不实的",
        "ornamentation": "装饰",
        "intoxication": "（兴奋得）飘飘然",
        "prudence": "谨慎，理智",
        "ravage": "（剪头发造成的）损毁、残局",
        "generosity": "慷慨，舍得",
        "mammoth": "巨大的，艰巨的",
        "truant": "逃学的",
        "chop": "排骨，肉排",
        "burden": "使……负担（养家）",
        "setter": "塞特猎犬（闻到鹌鹑时会一动不动）",
        "quail": "鹌鹑",
        "disapproval": "不满，不赞成",
        "wriggle": "扭着身子（从桌上下来）",
        "laboriously": "费劲地（一字一顿地问）",
        "patent": "明摆着的，显而易见的",
        "idiocy": "傻呆呆的样子",
        "trance": "发呆，恍惚",
        "enfold": "搂住，抱住",
        "discreet": "识趣的，不打扰的",
        "scrutiny": "仔细端详",
        "inconsequential": "无关紧要的",
        "assertion": "说法，断言",
        "illuminate": "解释清楚",
        "nimble": "灵巧的",
        "ecstatic": "狂喜的",
        "hysterical": "情绪失控的",
        "necessitate": "使……成为必要",
        "tortoise": "tortoise shell：玳瑁（壳）",
        "crave": "渴望",
        "yearn": "向往，惦记",
        "tress": "（女子的）长发",
        "adorn": "装饰，衬托",
        "covet": "渴望得到的",
        "adornment": "饰物（指那套发梳）",
        "singe": "（毛）被烧焦的",
        "ardent": "热切的",
        "dandy": "极好的东西（口语）",
        "magi": "麦琪，《圣经》里给耶稣送礼的东方三贤人",
        "manger": "马槽",
        "duplication": "（礼物）重复",
        "lamely": "笨拙地，不像样地",
        "chronicle": "（平淡的）故事，记述"
      }
    }
  },
  {
    "id": "why-cities-are-getting-hotter",
    "title": "Why Cities Are Getting Hotter",
    "author": "Tibi",
    "genre": "news",
    "source": "Tibi 自拟示例（MIT）",
    "is_default": false,
    "order": 3,
    "markdown": "On a summer afternoon, the center of a large city can feel noticeably hotter than the farmland a short drive away. The difference is not just a feeling. Scientists have measured it for decades and given it a name: the urban heat island. As cities grow and summers become more extreme, the effect is moving from a scientific curiosity to a public health concern.\n\n## Where the extra heat comes from\n\nThe main cause is the material that cities are built from. Asphalt roads, concrete pavements and dark rooftops absorb a large share of the sunlight that hits them. During the day they store that energy, and after sunset they slowly release it back into the air. This is why the gap between urban and rural temperatures is often widest at night, when the countryside cools quickly and the city does not.\n\nThe shape of a city matters too. Tall buildings on narrow streets trap heat and block the wind that might otherwise carry it away. Air conditioners, cars and factories add their own waste heat. And because so much of the ground is sealed, there is little bare soil or vegetation left to cool the surface through evaporation.\n\n## Why it matters\n\nHeat is easy to underestimate because it does not destroy buildings the way a flood or a storm does. Its damage is quieter. Prolonged hot weather puts a strain on the heart and kidneys, and the risk is highest for older people, young children, outdoor workers and anyone without a cool place to rest. Nights that stay warm are especially dangerous, because the body never gets a chance to recover.\n\nThe burden is rarely shared equally. Neighborhoods with fewer trees and more pavement tend to be hotter, and they are often the ones with lower incomes and older housing. In many cities, a map of summer temperatures looks strikingly similar to a map of income.\n\n## What cities are trying\n\nThe most familiar response is to plant trees. A mature tree shades the ground beneath it and releases water vapor through its leaves, which cools the surrounding air. Parks, green roofs and strips of planting along streets work in a similar way, and they bring other benefits, such as absorbing rainwater during heavy storms.\n\nAnother approach is to change the color of the city. Roofs and pavements painted in light, reflective coatings bounce more sunlight back into the sky instead of absorbing it. These \"cool roofs\" are relatively cheap and can be installed quickly, although critics point out that the benefit depends on the climate and that bright surfaces can create glare.\n\nSome cities are also rethinking how they respond during heatwaves themselves. Measures include opening air-conditioned public buildings as cooling centers, adjusting working hours for outdoor jobs, and checking on vulnerable residents who live alone.\n\n## A long-term problem\n\nNone of these measures will cancel the effect entirely. As long as cities are dense, paved and busy, they will be warmer than the land around them. But planners increasingly see heat as something that can be designed for, in the same way that drainage is designed for rain. The choices made now about streets, buildings and trees will shape how livable cities are for decades to come.",
    "ai": {
      "summary": "大城市市中心常比郊外农田热得多，这叫“城市热岛效应”。主要原因是沥青、混凝土和深色屋顶白天吸热、夜里放热，所以城乡温差往往在夜间最大；高楼窄街挡风、空调和汽车排热、缺少植被蒸发降温也在加剧。高温伤害老人、儿童和户外劳动者，而且树少、收入低的街区往往更热。城市的对策包括种树和绿化、刷浅色反光屋顶（“凉屋顶”），以及热浪期间开放避暑中心、调整户外工作时间。热岛无法完全消除，但可以像排水一样提前在城市设计中考虑。",
      "advice": "新闻解释类文章结构清楚：现象 → 原因 → 影响 → 对策 → 展望。读的时候可以先看小标题。生词多是环境与公共卫生领域的常用词（absorb、vulnerable、prolonged、mature），适合加入复习。",
      "phrases": [
        {
          "text": "a short drive away",
          "zh": "开车不远就到"
        },
        {
          "text": "put a strain on",
          "zh": "给……带来负担"
        },
        {
          "text": "point out",
          "zh": "指出"
        },
        {
          "text": "check on",
          "zh": "探望，查看（某人是否安好）"
        },
        {
          "text": "for decades to come",
          "zh": "在未来几十年里"
        }
      ],
      "hard_sentences": [
        {
          "s": "This is why the gap between urban and rural temperatures is often widest at night, when the countryside cools quickly and the city does not.",
          "zh": "这就是为什么城乡温差往往在夜里最大：那时乡村很快降温，城市却不会。when 引导的从句修饰 at night。"
        },
        {
          "s": "But planners increasingly see heat as something that can be designed for, in the same way that drainage is designed for rain.",
          "zh": "但规划者越来越把高温看作可以在设计时预先考虑的问题，就像为降雨设计排水一样。see A as B：把 A 看作 B。"
        }
      ],
      "context_meanings": {
        "noticeably": "明显地",
        "farmland": "农田",
        "urban": "城市的",
        "extreme": "极端的",
        "curiosity": "（只引起好奇的）新奇现象",
        "asphalt": "沥青",
        "concrete": "混凝土",
        "pavement": "（铺砌的）路面",
        "rooftop": "屋顶",
        "absorb": "吸收",
        "release": "释放",
        "rural": "乡村的",
        "countryside": "乡村",
        "trap": "困住（热量）",
        "waste": "waste heat：废热",
        "sealed": "（地面被）封住的，硬化的",
        "bare": "裸露的",
        "soil": "土壤",
        "vegetation": "植被",
        "evaporation": "蒸发",
        "underestimate": "低估",
        "prolonged": "长时间的，持续的",
        "strain": "负担，压力",
        "kidney": "肾脏",
        "burden": "负担（这里指高温带来的伤害）",
        "neighborhood": "街区，社区",
        "strikingly": "惊人地，显著地",
        "mature": "成年的，长成的（树）",
        "vapor": "水蒸气",
        "reflective": "反光的",
        "coating": "涂层",
        "install": "安装，铺设",
        "critic": "批评者，持不同意见的人",
        "glare": "刺眼的强光",
        "heatwave": "热浪",
        "vulnerable": "易受伤害的",
        "resident": "居民",
        "entirely": "完全地",
        "dense": "（人口、建筑）稠密的",
        "paved": "铺了路面的",
        "planner": "（城市）规划者",
        "drainage": "排水（系统）",
        "livable": "宜居的"
      }
    }
  }
];
