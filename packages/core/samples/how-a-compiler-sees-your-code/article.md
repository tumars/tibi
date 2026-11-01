---
id: how-a-compiler-sees-your-code
title: How a Compiler Sees Your Code
author: Tibi
genre: tech
source: Tibi 自拟示例（MIT）
default: true
order: 1
---

You write code as a story for other people. The compiler reads it as a long, flat string of characters. Everything a compiler does is an attempt to recover the structure that you had in mind, check that it makes sense, and then translate it into something a machine can execute. This article walks through those stages using one tiny function.

```rust
fn area(width: u32, height: u32) -> u32 {
    let result = width * height;
    result
}
```

## Lexing: from characters to tokens

The first stage is lexical analysis, usually called lexing. The lexer scans the source text from left to right and groups characters into tokens. A token is the smallest unit that carries meaning: a keyword such as `fn`, an identifier such as `width`, a symbol such as `->`, or a literal number. Whitespace and comments are typically discarded at this point, because they matter to humans but not to the grammar.

Lexing sounds trivial, but it has to resolve some ambiguity. When the lexer sees `-` followed by `>`, it must decide whether these are two separate operators or a single arrow. Most lexers follow the rule of the longest match: keep consuming characters as long as the result is still a valid token.

## Parsing: from tokens to a tree

A flat list of tokens still has no shape. The parser takes the tokens and checks them against the grammar of the language, building an abstract syntax tree, or AST. In the tree, the function is a node with children for its name, its parameters, its return type and its body. The expression `width * height` becomes a multiplication node with two leaves.

The tree is called abstract because it leaves out details that only existed to make the text readable. Parentheses, for example, disappear once their job is done: their only purpose was to tell the parser how to group things, and the shape of the tree now records that grouping explicitly.

If the tokens do not fit the grammar, this is where you get a syntax error. Good parsers try to recover after an error and keep going, so that one missing semicolon does not hide every other mistake in the file.

## Semantic analysis: does it make sense?

A program can be grammatically correct and still be nonsense. Semantic analysis walks the tree and asks harder questions. Does every name refer to something that has been declared? Are the types compatible? Is a value used after it has been moved somewhere else?

In our example, the checker confirms that `width` and `height` are both `u32`, that multiplying them produces a `u32`, and that the function returns the type it promised. This is also the stage where languages like Rust enforce ownership and borrowing rules. The errors you see here are often the most valuable ones, because they describe mistakes that would otherwise surface as bugs at runtime.

## Intermediate representation

Once the program is known to be valid, most compilers lower the tree into an intermediate representation, or IR. An IR is simpler and more uniform than the source language. Loops, conditionals and method calls are reduced to a small set of primitive operations and explicit jumps between blocks.

The point of an IR is to decouple the front end of the compiler from the back end. Many languages can share the same IR, and the same IR can be translated for many processors. This is why a single toolchain can support several languages and several kinds of hardware without writing every combination by hand.

## Optimization

Working on the IR, the optimizer tries to produce a program that behaves identically but runs faster or uses less memory. It might notice that `result` is assigned once and immediately returned, and remove the variable altogether. It might evaluate `2 * 8` at compile time instead of at runtime, a technique known as constant folding. It might inline a small function so that the overhead of calling it disappears.

Optimizations must be conservative. The compiler is only allowed to change how the program works, never what it does. That guarantee is what makes it safe to turn optimizations on without rereading your own code.

## Code generation

The final stage turns the optimized IR into instructions for a specific processor. The code generator chooses which instructions to use, assigns values to a limited number of registers, and decides what has to spill into memory. The output is an object file, which a linker then combines with libraries to produce an executable.

## Why this matters to you

You do not need to write a compiler to benefit from knowing how one works. Error messages become easier to read once you can tell whether they come from the parser or from the type checker. Performance advice makes more sense when you know what the optimizer can and cannot see. And the next time a build takes too long, you will have a rough idea of where the time might be going.
