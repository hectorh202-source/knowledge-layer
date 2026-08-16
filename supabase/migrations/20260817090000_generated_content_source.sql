-- 'generated' as a content source.
--
-- The enum was written before the FAQ generator existed and lists only the
-- places content can be *found* — a directory, a crawl, a person. Assembled
-- content is a fourth origin and a meaningfully different one: nobody said it,
-- the app built it from facts already approved, and it is the category most
-- worth being able to filter on before publishing in a business's name.
--
-- Migrating a client whose FAQs were generated failed on this, which is how it
-- was found. The value was already being written into the `provenance` jsonb
-- correctly; only the enum column rejected it.

alter type content_source add value if not exists 'generated';
