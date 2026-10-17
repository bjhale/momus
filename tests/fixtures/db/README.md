# Fixture databases

`v0.9.4.sqlite` was written by the real momus v0.9.4 CLI (`snapshot`, then
`run`) against two tiny local sites. It is the RFC-0002 compatibility fixture:
every schema migration must open it and keep its baseline diffable. Never
regenerate it with a newer momus; that would defeat the point.

To reproduce it, see the header of `make-v0.9.4.ts`.
