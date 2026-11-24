# Графические ресурсы виртуальной учительской

Созданы встроенным `image_gen` по визуальному референсу пользователя; CLI/API с пользовательским ключом не использовались. Финальные изображения скопированы в проект, не зависят от каталога Codex.

| Ресурс | Путь | Формат |
|---|---|---|
| Интерьер без персонажей | `frontend/public/office/staffroom.png` | 1672×941, PNG |
| Ходьба и взаимодействие | `frontend/public/office/agents.png` | 1261×1247, PNG с alpha, 4×4 |
| Сидение, печать, чтение | `frontend/public/office/working.png` | 1261×1247, PNG с alpha, 4×4 |

Строки обоих атласов: coordinator, methodist, creative, assessment. Колонки первого: idle, шаг 1, шаг 2, передача документа. Колонки второго: сидение, печать 1, печать 2, чтение. Texture frames рассчитываются из реального размера атласов; движение интерполируется в PixiJS. Направление влево получается отражением спрайта; это не набор 8 отдельных направлений.

## Финальные prompts

### Интерьер

Use case: stylized-concept. Asset type: production background for interactive isometric game scene in AI EDU web app. Reference: the attached AI EDU virtual staffroom screenshot, specifically the right-hand office interior. Create ONLY the empty office background, no people, no characters, no UI panels, no floating labels. Landscape 16:9 image. Beautiful highly detailed warm pixel art / polished isometric 2.5D cozy teachers staffroom. Match purple peach lavender oak wood palette. Large sunlit blue glass windows along left/back wall, bookshelf and plants at back right, orange couch at back, lit purple sign on back wall reading AI EDU. Blank white task board on upper right. Four small empty desks with monitors, keyboards, papers and coffee mugs arranged 2 by 2, upper left desk, upper right desk, lower left double monitor desk, lower right laptop desk. Empty chairs. Broad clear walkable aisle through middle. Diagonal wooden floorboards, many lush potted plants, bookshelves, sunlight. Camera looks down into room from open fourth wall, detailed pixel game art with crisp readable silhouettes and soft volumetric light. Composition fills frame edge to edge, no outer whitespace. No avatars baked into background; four characters will be separately animated over this image. No other text.

### Персонажи в движении

Use case: stylized-concept. Asset type: transparent game sprite atlas for AI EDU isometric staffroom. Create precisely a regular 4 columns x 4 rows sprite sheet on truly transparent background, all 16 cells equal size, one isolated FULL BODY chibi pixel art teacher character per cell, no text no labels no cell borders no floor no furniture. Crisp beautiful detailed pixel art matching warm isometric 2.5D cozy management game. Consistent proportions (large head small body), top-down three quarter camera facing lower right, entire character plus props inside each cell with generous padding. FOUR characters by ROW: row1 coordinator man, dark brown hair glasses navy suit and white shirt; row2 methodologist woman, brown hair in bun, white blouse lilac vest and dark skirt; row3 creative young man purple headphones and purple hoodie dark pants; row4 assessment woman long dark brown hair glasses cream shirt dark purple trousers. FOUR poses by COLUMN: column1 standing idle facing camera-right, column2 walking left leg forward arms swinging, column3 walking right leg forward opposite arms swinging, column4 reading/holding white document with hand pointing outward to give document. Row identities and clothing must remain consistent. Transparent background, no opaque backdrops, no shadows extending into adjacent cells. Each cell one character same centered scale, feet aligned at same baseline. Need clean usable transparent sprite atlas, polished quality.

### Работа за столом

Create a second companion sprite atlas matching the previous transparent character sheet. Production pixel art game sprites, transparent background. Precisely regular 4 columns x 4 rows grid, equal cells, one full-body chibi character in each, consistent size and identity each row, top-down isometric view facing lower right. ROW 1 navy suited brown-haired man glasses coordinator; ROW 2 brown bun woman white blouse lilac vest methodologist; ROW 3 man purple hoodie and purple headphones creative; ROW 4 woman long dark hair glasses cream shirt purple pants assessor. COLUMNS: column1 SEATED pose with bent knees hands at rest as if behind an invisible desk; column2 SEATED typing both hands forward as if using invisible keyboard, fingers down; column3 SEATED typing alternative frame fingers up; column4 SEATED reading a white document. No actual chair or desk or computer, isolated character only, no labels no text no cell lines. Pixel-perfect warm polished pixel art similar to cozy 2.5D management game. Clear separation generous transparent padding, entire body inside cell, identical baseline and scale. Actual alpha transparency.
