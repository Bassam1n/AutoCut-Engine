-- Editor feedback: generated scene images/videos sometimes render a
-- product at the wrong scale because nothing tells the image/video
-- prompt writer the product's actual physical size. Adds a single
-- free-text field rather than structured height/width/depth numeric
-- columns: an editor usually has a confident sense of "about how
-- tall/long this is" (or a size analogy like "about the size of a
-- soda can") but rarely knows precise width+depth without a ruler in
-- hand, and three demanded numeric inputs invite guessed-at precision
-- that reads as more authoritative than it is. A free-text field lets
-- them write whatever they actually know ("15cm tall, 8cm wide",
-- "about the size of a shoebox") and that same text is exactly what
-- gets handed to Claude as prompt context anyway — no unit coercion
-- or structured-to-prose conversion step needed before it reaches
-- write_image_prompt/write_video_prompt.
alter table public.products
  add column real_world_size text;
