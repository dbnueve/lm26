"""Draft intelligence system: champion traits, synergies, counters, AI logic.

All public functions that need GAME_STATE receive it as a parameter or via
the helper functions _get_team_champ_pool / _get_team_champ_pool_by_pos.
"""
import random
from typing import Optional
from app_state import GAME_STATE

# ── Champion trait database ────────────────────────────────────────────────
# Trait tuple: (dmg_type, cc_level, archetypes_tuple)
CHAMP_TRAITS: dict = {
    # TOP
    "Rumble":       ("AP",    1, ("tf","pok","bru")),
    "K'Sante":      ("Mixed", 2, ("eng","tank","tf")),
    "Sion":         ("AD",    3, ("eng","tank","tf")),
    "Ambessa":      ("AD",    1, ("bru","ass","eg")),
    "Gnar":         ("Mixed", 2, ("pok","tf","dis")),
    "Renekton":     ("AD",    1, ("bru","eg")),
    "Poppy":        ("AD",    2, ("tank","eng","dis")),
    "Gwen":         ("AP",    0, ("bru","sp")),
    "Jax":          ("Mixed", 1, ("sp","bru","scl")),
    "Ornn":         ("Mixed", 3, ("eng","tank","tf","scl")),
    "Kennen":       ("AP",    2, ("pok","tf")),
    "Kled":         ("AD",    1, ("bru","eg","sp")),
    "Gragas":       ("AP",    2, ("eng","dis","tank")),
    "Yasuo":        ("AD",    0, ("bru","sp","scl")),
    "Shen":         ("Mixed", 2, ("tank","eng","uti")),
    "Volibear":     ("Mixed", 2, ("eng","tank","eg")),
    # JUNGLE
    "Xin Zhao":     ("AD",    1, ("bru","eng","eg")),
    "Vi":           ("AD",    2, ("eng","bru","eg")),
    "Jarvan IV":    ("AD",    2, ("eng","tf","eg")),
    "Pantheon":     ("AD",    2, ("bru","ass","eg","pok")),
    "Dr. Mundo":    ("Mixed", 0, ("tank","sp","scl")),
    "Jayce":        ("Mixed", 1, ("pok","sp","bru")),
    "Wukong":       ("AD",    1, ("bru","tf","eg")),
    "Aatrox":       ("AD",    1, ("bru","scl")),
    "Malphite":     ("AP",    3, ("eng","tank","tf")),
    "Nocturne":     ("AD",    1, ("ass","eg")),
    "Zac":          ("AP",    2, ("eng","tank","tf")),
    "Skarner":      ("Mixed", 2, ("eng","tank")),
    "Sejuani":      ("Mixed", 3, ("eng","tank","tf")),
    "Qiyana":       ("AD",    1, ("ass","eg","tf")),
    "Naafiri":      ("AD",    0, ("ass","eg")),
    "Trundle":      ("AD",    1, ("bru","tank")),
    # MID
    "Azir":         ("AP",    1, ("tf","pok","scl","dis")),
    "Orianna":      ("AP",    2, ("tf","pok","scl")),
    "Taliyah":      ("AP",    2, ("pok","tf","uti")),
    "Ryze":         ("AP",    1, ("pok","scl","tf")),
    "Akali":        ("AP",    0, ("ass","sp")),
    "Ahri":         ("AP",    1, ("ass","pok","dis")),
    "Aurora":       ("AP",    1, ("pok","tf")),
    "Anivia":       ("AP",    2, ("pok","scl","tf")),
    "Galio":        ("AP",    2, ("tank","eng","tf","uti")),
    "Yone":         ("Mixed", 1, ("bru","ass","scl")),
    "Cassiopeia":   ("AP",    1, ("pok","scl","tf")),
    "Viktor":       ("AP",    1, ("pok","tf","scl")),
    "Aurelion Sol": ("AP",    0, ("pok","scl","tf")),
    "LeBlanc":      ("AP",    1, ("ass","pok")),
    "Syndra":       ("AP",    2, ("pok","ass")),
    "Zoe":          ("AP",    2, ("pok","ass")),
    # ADC
    "Yunara":       ("AD",    0, ("scl","tf")),
    "Varus":        ("Mixed", 2, ("pok","scl","tf")),
    "Corki":        ("Mixed", 0, ("pok","eg")),
    "Ezreal":       ("Mixed", 0, ("pok","dis","scl")),
    "Aphelios":     ("AD",    0, ("scl","tf","pok")),
    "Kai'Sa":       ("Mixed", 0, ("scl","ass")),
    "Caitlyn":      ("AD",    1, ("pok","eg")),
    "Jhin":         ("AD",    1, ("pok","tf")),
    "Sivir":        ("AD",    0, ("tf","scl","uti")),
    "Ashe":         ("AD",    2, ("pok","tf","uti")),
    "Xayah":        ("AD",    1, ("dis","scl")),
    "Jinx":         ("AD",    0, ("scl","tf")),
    "Lucian":       ("AD",    0, ("eg","pok")),
    "Kalista":      ("AD",    0, ("scl","uti")),
    "Smolder":      ("AD",    0, ("scl","pok")),
    # SUPPORT
    "Alistar":      ("Mixed", 3, ("eng","tank","uti")),
    "Bard":         ("Mixed", 2, ("uti","dis","pok")),
    "Rakan":        ("AP",    2, ("eng","dis","uti")),
    "Nautilus":     ("Mixed", 3, ("eng","tank")),
    "Neeko":        ("AP",    2, ("eng","tf","pok")),
    "Nami":         ("AP",    2, ("uti","pok","scl")),
    "Lulu":         ("AP",    1, ("uti","dis","pok")),
    "Karma":        ("AP",    1, ("pok","uti","dis")),
    "Seraphine":    ("AP",    1, ("pok","tf","uti")),
    "Rell":         ("Mixed", 3, ("eng","tank","tf")),
    "Braum":        ("Mixed", 3, ("eng","tank","dis")),
    "Leona":        ("Mixed", 3, ("eng","tank")),
    "Thresh":       ("Mixed", 2, ("eng","uti","dis")),
    "Renata Glasc": ("AP",    1, ("uti","tf")),
    "Pyke":         ("AD",    1, ("ass","eng")),
    "Elise":        ("AP",    1, ("ass","eg")),
}

# Known synergy pairs
SYNERGY_PAIRS: list = [
    (frozenset({"Rakan",     "Xayah"}),    3.0),
    (frozenset({"Thresh",    "Kalista"}),  2.5),
    (frozenset({"Nami",      "Kalista"}),  2.0),
    (frozenset({"Orianna",   "Malphite"}), 2.5),
    (frozenset({"Orianna",   "Vi"}),       2.5),
    (frozenset({"Orianna",   "Zac"}),      2.0),
    (frozenset({"Jarvan IV", "Orianna"}),  2.0),
    (frozenset({"Malphite",  "Yasuo"}),    2.5),
    (frozenset({"Malphite",  "Yone"}),     2.0),
    (frozenset({"Sion",      "Yasuo"}),    2.0),
    (frozenset({"Jarvan IV", "Azir"}),     2.0),
    (frozenset({"Jarvan IV", "Taliyah"}),  2.0),
    (frozenset({"Taliyah",   "Orianna"}),  1.5),
    (frozenset({"Galio",     "Orianna"}),  2.0),
    (frozenset({"Galio",     "Azir"}),     1.5),
    (frozenset({"Lulu",      "Jinx"}),     2.0),
    (frozenset({"Lulu",      "Aphelios"}), 2.0),
    (frozenset({"Lulu",      "Yunara"}),   2.0),
    (frozenset({"Lulu",      "Xayah"}),    1.5),
    (frozenset({"Nami",      "Lucian"}),   2.5),
    (frozenset({"Karma",     "Caitlyn"}),  1.5),
    (frozenset({"Seraphine", "Aphelios"}), 1.5),
    (frozenset({"Varus",     "Alistar"}),  2.0),
    (frozenset({"Varus",     "Rell"}),     2.0),
    (frozenset({"Varus",     "Leona"}),    2.0),
    (frozenset({"Ashe",      "Nautilus"}), 1.5),
    (frozenset({"Ashe",      "Jarvan IV"}),1.5),
    (frozenset({"Alistar",   "Caitlyn"}),  1.5),
    (frozenset({"Alistar",   "Ezreal"}),   1.5),
    (frozenset({"Leona",     "Ezreal"}),   1.5),
    (frozenset({"Nautilus",  "Jhin"}),     2.0),
    (frozenset({"Rell",      "Jinx"}),     1.5),
    (frozenset({"Sivir",     "Orianna"}),  2.0),
    (frozenset({"Sivir",     "Azir"}),     1.5),
    (frozenset({"Sivir",     "Malphite"}), 2.0),
    (frozenset({"Sivir",     "Galio"}),    1.5),
    (frozenset({"Shen",      "Jhin"}),     2.0),
    (frozenset({"Shen",      "Darius"}),   1.5),
    (frozenset({"Galio",     "Corki"}),    1.5),
    (frozenset({"Twisted Fate","Nocturne"}),2.0),
    (frozenset({"Twisted Fate","Elise"}),  1.5),
    (frozenset({"Jayce",     "Ezreal"}),   1.5),
    (frozenset({"Jayce",     "Corki"}),    2.0),
    (frozenset({"Caitlyn",   "Zyra"}),     1.5),
    (frozenset({"Caitlyn",   "Lux"}),      1.5),
    (frozenset({"Ezreal",    "Yuumi"}),    2.0),
    (frozenset({"Karma",     "Ezreal"}),   1.5),
    (frozenset({"Azir",      "Aphelios"}), 1.5),
    (frozenset({"Viktor",    "Sejuani"}),  1.5),
    (frozenset({"Cassiopeia","Galio"}),    1.5),
    (frozenset({"Ryze",      "Neeko"}),    2.0),
    (frozenset({"Aatrox",    "Orianna"}),  1.5),
    (frozenset({"Gnar",      "Orianna"}),  1.5),
    (frozenset({"Gragas",    "Yasuo"}),    2.0),
    (frozenset({"Gragas",    "Yone"}),     1.5),
    (frozenset({"Seraphine", "Sion"}),     1.5),
    (frozenset({"Bard",      "Alistar"}),  1.5),
    (frozenset({"Renata Glasc","Jinx"}),   2.0),
    (frozenset({"Renata Glasc","Aphelios"}),1.5),
    (frozenset({"Thresh",    "Xayah"}),    1.5),
    (frozenset({"Senna",     "Tahm Kench"}), 3.0),
    (frozenset({"Senna",     "Sion"}),       2.5),
    (frozenset({"Senna",     "Maokai"}),     2.5),
    (frozenset({"Seraphine", "Senna"}),      2.0),
    (frozenset({"Zeri",      "Yuumi"}),      2.5),
    (frozenset({"Zeri",      "Lulu"}),       2.5),
    (frozenset({"Milio",     "Kog'Maw"}),    2.5),
    (frozenset({"Milio",     "Lucian"}),     2.0),
    (frozenset({"Nami",      "Smolder"}),    2.0),
    (frozenset({"Sejuani",   "Renekton"}),   2.5),
    (frozenset({"Sejuani",   "Yone"}),       2.0),
    (frozenset({"Vi",        "Ahri"}),       2.5),
    (frozenset({"Maokai",    "Tristana"}),   2.0),
    (frozenset({"Lee Sin",   "Leblanc"}),    2.0),
    (frozenset({"Nocturne",  "Neeko"}),      2.5),
    (frozenset({"Rumble",    "Jarvan IV"}),  2.5),
    (frozenset({"Rumble",    "Rell"}),       2.5),
    (frozenset({"Amumu",     "Miss Fortune"}), 2.5),
    (frozenset({"Maokai",    "Miss Fortune"}), 2.0),
    (frozenset({"Diana",     "Yasuo"}),      2.5),
    (frozenset({"Braum",     "Lucian"}),     2.5),
    (frozenset({"Draven",    "Nautilus"}),   2.5),
    (frozenset({"Draven",    "Pyke"}),       2.0),
    (frozenset({"Kalista",   "Renata Glasc"}), 2.5),
    (frozenset({"Samira",    "Nautilus"}),   2.5),
    (frozenset({"Samira",    "Rell"}),       2.5),
    (frozenset({"Briar",     "Shen"}),       2.0),
    (frozenset({"Galio",     "Camille"}),    2.5),
    (frozenset({"Taliyah",   "Pantheon"}),   2.0),
    (frozenset({"K'Sante",   "Orianna"}),    1.5),
    (frozenset({"Alistar",      "Kai'Sa"}),     3.0),
    (frozenset({"Bard",         "Ezreal"}),      3.0),
    (frozenset({"Ezreal",       "Rakan"}),       3.0),
    (frozenset({"Jinx",         "Thresh"}),      3.0),
    (frozenset({"Kai'Sa",       "Nautilus"}),    3.0),
    (frozenset({"Ambessa",      "Vi"}),          2.5),
    (frozenset({"Aphelios",     "Thresh"}),      2.5),
    (frozenset({"Ashe",         "Seraphine"}),   2.5),
    (frozenset({"Bard",         "Jhin"}),        2.5),
    (frozenset({"Braum",        "Sejuani"}),     2.5),
    (frozenset({"Braum",        "Yunara"}),      2.5),
    (frozenset({"Dr. Mundo",    "Orianna"}),     2.5),
    (frozenset({"Ezreal",       "Neeko"}),       2.5),
    (frozenset({"Galio",        "Nocturne"}),    2.5),
    (frozenset({"Jinx",         "Leona"}),       2.5),
    (frozenset({"Kai'Sa",       "Neeko"}),       2.5),
    (frozenset({"Karma",        "Yunara"}),      2.5),
    (frozenset({"Nocturne",     "Orianna"}),     2.5),
    (frozenset({"Taliyah",      "Vi"}),          2.5),
    (frozenset({"Yasuo",        "Yone"}),        2.0),
    (frozenset({"Yasuo",        "Zac"}),         2.0),
]

# Counter map: champion → set of champions it counters
COUNTER_MAP: dict = {
    "Aatrox":       {"Dr. Mundo", "Elise", "Gragas", "Gwen", "Jarvan IV", "Pantheon",
                     "Poppy", "Sejuani", "Shen", "Sion", "Skarner", "Vi", "Volibear",
                     "Xin Zhao", "Zac"},
    "Malphite":     {"Yasuo", "Yone", "Corki", "Lucian", "Jinx", "Aphelios", "Kalista", "Ashe", "Caitlyn", "Gnar", "Jayce", "Jhin", "Naafiri",
                     "Pantheon", "Qiyana"},
    "Poppy":        {"Vi", "Jarvan IV", "Xin Zhao", "Nocturne", "Gragas", "Wukong", "Skarner", "Lee Sin", "Ahri", "Akali", "Ashe", "Caitlyn", "Jhin", "LeBlanc",
                     "Naafiri", "Pantheon", "Qiyana", "Yasuo", "Zac"},
    "Ornn":         {"Gnar", "Kennen", "Rumble", "Renekton","Akali", "Ashe", "Caitlyn", "Jayce", "Jhin",
                     "Malphite", "Naafiri", "Pantheon", "Qiyana"},
    "Renekton":     {"Sion", "Aatrox", "Gwen", "Mordekaiser","Ambessa", "K'Sante", "Yasuo", "Yone"},
    "Jax":          {"Renekton", "Gwen", "Dr. Mundo", "Darius", "Camille", "Volibear", "Yasuo", "Yone"},
    "Gnar":         {"Ornn", "Malphite", "Sion", "K'Sante", "Jax", "Renekton", "Volibear"},
    "Pantheon":     {"Sion", "Ornn", "Garen", "Nasus"},
    "Shen":         {"Nocturne", "Pantheon", "Tryndamere","Akali", "Caitlyn", "Jax", "Malphite", "Ornn",
                     "Qiyana", "Sion", "Volibear"},
    "Kennen":       {"Malphite", "Sion", "Ornn",
                     "Ambessa", "Gragas", "Gwen", "Jax", "Rumble", "Volibear", "Yasuo", "Yone"},
    "Rumble":       {"Ornn", "Maokai", "Cho'Gath", "Garen","Gnar", "Jax", "Malphite", "Renekton"},
    "Gragas":       {"Renekton", "Akali", "Jax", "Jayce", "Volibear"},
    "Kled":         {"Gnar", "Sion", "Yasuo"},
    "Volibear":     {"Gnar", "Kennen", "Jax"},
    "Ambessa":      {"Gnar", "Renekton", "Aatrox", "Jax"},
    "K'Sante":      {"Fiora", "Jax", "Gwen","Ashe", "Caitlyn", "Dr. Mundo", "Jhin",
                     "Malphite", "Naafiri", "Ornn", "Pantheon", "Qiyana", "Sion", "Volibear"},
    "Darius":       {"Garen", "Nasus", "Sion", "Cho'Gath"},
    "Fiora":        {"K'Sante", "Aatrox", "Mordekaiser", "Jax"},
    "Camille":      {"Gnar", "Jayce", "Kennen"},
    "Mordekaiser":  {"Illaoi", "Yorick", "Malphite"},
    "Olaf":         {"Morgana", "Leona", "Nautilus", "Lux"},
    "Gwen":         {"Alistar", "Braum", "Dr. Mundo", "Elise", "Jarvan IV", "K'Sante",
                     "Leona", "Malphite", "Nautilus", "Ornn", "Pantheon", "Poppy",
                     "Rell", "Sejuani", "Shen", "Sion", "Skarner", "Vi", "Xin Zhao", "Zac"},
    "Jayce":        {"Aatrox", "Akali", "Gnar", "Gwen", "Jax", "Kennen", "Renekton", "Volibear", "Yone"},
    "Sion":         {"Akali", "Ashe", "Caitlyn", "Jayce", "Jhin", "Kennen",
                     "Malphite", "Naafiri", "Pantheon", "Qiyana", "Rumble"},
    "Trundle":      {"Malphite", "Cho'Gath", "Dr. Mundo", "Sion", "Sejuani"},
    "Wukong":       {"Amumu", "Sejuani", "Zac", "Gragas", "Jarvan IV", "Naafiri", "Pantheon", "Poppy",
                     "Skarner", "Vi", "Volibear", "Xin Zhao"},
    "Nocturne":     {"Twisted Fate", "Shen", "Pantheon", "Karthus",
                     "Elise", "Gragas", "Jhin", "Naafiri", "Poppy", "Sejuani", "Skarner", "Vi", "Volibear"},
    "Hecarim":      {"Nunu", "Amumu", "Lillia"},
    "Vi":           {"Nidalee", "Elise", "Lee Sin", "Zeri"},
    "Sejuani":      {"Jarvan IV", "Vi", "Xin Zhao",
                     "Akali", "Ashe", "Caitlyn", "Jhin", "Naafiri", "Pantheon", "Qiyana"},
    "Zac":          {"Nidalee", "Kindred", "Twitch",
                     "Akali", "Ashe", "Caitlyn", "Dr. Mundo", "Jhin", "Karma", "Naafiri", "Nami",
                     "Pantheon", "Qiyana", "Seraphine"},
    "Skarner":      {"Nunu", "Rammus", "Hecarim"},
    "Xin Zhao":     {"Kindred", "Nunu", "Naafiri"},
    "Jarvan IV":    {"Lee Sin", "Nidalee", "Ezreal",
                     "Ashe", "Jhin", "Orianna", "Sivir", "Viktor", "Zac"},
    "Graves":       {"Evelynn", "Shaco", "Rengar"},
    "Lee Sin":      {"Amumu", "Rammus", "Karthus"},
    "Elise":        {"Nunu", "Kindred", "Lee Sin"},
    "Naafiri":      {"Karthus", "Fiddle", "Brand",
                     "Aurelion Sol", "Dr. Mundo", "LeBlanc", "Shen", "Syndra", "Zoe"},
    "Rammus":       {"Bel'Veth", "Master Yi", "Briar", "Lucian"},
    "Kindred":      {"Zac", "Sejuani", "Vi"},
    "Bel'Veth":     {"Lillia", "Karthus", "Evelynn"},
    "Nidalee":      {"Graves", "Kindred"},
    "Dr. Mundo":    {"Ashe", "Caitlyn", "Gragas", "Jax", "Jayce", "Jhin", "Kennen",
                     "Malphite", "Nocturne", "Pantheon", "Qiyana", "Renekton", "Sion", "Wukong"},
    "Galio":        {"Akali", "Ahri", "LeBlanc", "Syndra", "Zoe", "Qiyana", "Naafiri",
                     "Karma", "Nami", "Ryze", "Seraphine"},
    "Ahri":         {"Akali", "Naafiri", "LeBlanc", "Qiyana",
                     "Aurelion Sol", "Galio", "Yone"},
    "Viktor":       {"Azir", "Orianna", "Corki"},
    "Qiyana":       {"Azir", "Orianna", "Corki", "Taliyah",
                     "Anivia", "Aurelion Sol", "Galio", "Naafiri", "Syndra"},
    "LeBlanc":      {"Syndra", "Viktor", "Orianna", "Azir", "Taliyah", "Yone"},
    "Syndra":       {"Cassiopeia", "Ryze", "Azir", "Galio", "Yone"},
    "Orianna":      {"Akali", "LeBlanc", "Yone"},
    "Azir":         {"LeBlanc", "Talon", "Fizz", "Sylas",
                     "Alistar", "Anivia", "Braum", "Dr. Mundo", "K'Sante", "Leona", "Malphite",
                     "Naafiri", "Nautilus", "Ornn", "Poppy", "Rell", "Sejuani",
                     "Shen", "Sion", "Yasuo", "Zac"},
    "Taliyah":      {"Azir", "Orianna", "LeBlanc", "Anivia", "Vi", "Viktor"},
    "Cassiopeia":   {"Yasuo", "Yone", "Irelia", "Lee Sin",
                     "Alistar", "Braum", "Dr. Mundo", "K'Sante", "Leona", "Malphite", "Nautilus",
                     "Ornn", "Poppy", "Rell", "Ryze", "Sejuani", "Shen", "Sion", "Zac"},
    "Twisted Fate": {"Ryze", "Orianna", "Akali"},
    "Corki":        {"Azir", "Taliyah", "Varus"},
    "Aurora":       {"Syndra", "Zoe", "Viktor"},
    "Zoe":          {"Ryze", "Orianna", "Azir", "Qiyana", "Viktor"},
    "Anivia":       {"Corki", "Azir", "Yone", "Ryze", "Zoe"},
    "Aurelion Sol": {"Anivia", "Orianna"},
    "Sivir":        {"Zac", "Alistar", "Nautilus", "Malphite", "Leona", "Pyke", "Varus"},
    "Ezreal":       {"Nautilus", "Pyke", "Thresh"},
    "Xayah":        {"Alistar", "Nautilus", "Rell", "Leona", "Jarvan IV",
                     "Galio", "Gnar", "Gragas", "Kai'Sa", "Malphite", "Neeko",
                     "Ornn", "Poppy", "Sejuani", "Zac"},
    "Caitlyn":      {"Alistar", "Thresh", "Vayne"},
    "Aphelios":     {"Sivir", "Kai'Sa"},
    "Ashe":         {"Nocturne", "Naafiri", "Braum", "Kalista", "Lulu"},
    "Jhin":         {"Alistar", "Blitzcrank", "Brand"},
    "Jinx":         {"Alistar", "Nami", "Sona"},
    "Kalista":      {"Zac", "Jarvan IV", "Amumu"},
    "Varus":        {"Alistar", "Leona", "Nautilus", "Maokai"},
    "Lucian":       {"Kalista", "Jinx", "Ezreal"},
    "Draven":       {"Jinx", "Aphelios", "Xayah", "Kai'Sa"},
    "Smolder":      {"Caitlyn", "Jhin", "Senna"},
    "Kai'Sa":       {"Ezreal", "Jhin"},
    "Samira":       {"Ashe", "Miss Fortune", "Caitlyn", "Jinx"},
    "Yunara":       {"Sivir"},
    "Lulu":         {"Nocturne", "Malphite", "Zac", "Vi", "Jarvan IV",
                     "Akali", "Alistar", "Galio", "Pantheon", "Pyke", "Rakan", "Rell"},
    "Braum":        {"Ezreal", "Aphelios", "Kalista", "Caitlyn", "Ashe",
                     "Akali", "Alistar", "Galio", "Jhin", "Leona", "Naafiri",
                     "Nautilus", "Ornn", "Pantheon", "Pyke", "Qiyana", "Thresh", "Yasuo", "Zac"},
    "Alistar":      {"Caitlyn", "Jinx", "Aphelios", "Leona",
                     "Akali", "Ashe", "Jhin", "Kennen", "Naafiri", "Nami", "Nautilus", "Qiyana"},
    "Thresh":       {"Jinx", "Caitlyn", "Aphelios", "LeBlanc", "Karma", "Nami"},
    "Morgana":      {"Blitzcrank", "Nautilus", "Thresh", "Leona", "Rell"},
    "Nautilus":     {"Lucian", "Ezreal",
                     "Akali", "Ashe", "Caitlyn", "Jhin", "Karma", "Naafiri", "Nami",
                     "Pantheon", "Qiyana", "Seraphine"},
    "Leona":        {"Jinx",
                     "Akali", "Ashe", "Caitlyn", "Jhin", "Naafiri", "Nami", "Nautilus", "Qiyana"},
    "Rell":         {"Ezreal", "Corki", "Xayah", "Seraphine",
                     "Akali", "Ashe", "Braum", "Caitlyn", "Jhin", "Naafiri",
                     "Nautilus", "Qiyana", "Rakan"},
    "Nami":         {"Alistar", "Leona", "Ashe", "Pantheon", "Rakan", "Rell"},
    "Seraphine":    {"Zac", "Vi", "Sion", "Ashe"},
    "Renata Glasc": {"Jinx", "Twitch", "Master Yi", "Draven"},
    "Karma":        {"Ashe"},
    "Pyke":         {"Thresh", "Nautilus", "Karma", "Nami", "Seraphine"},
    "Bard":         {"Jarvan IV", "Skarner", "Zac", "Braum", "Rakan", "Seraphine"},
    "Blitzcrank":   {"Lulu", "Nami", "Sona", "Soraka"},
    "Milio":        {"Leona", "Nautilus", "Rell", "Varus"},
    "Zyra":         {"Rell", "Leona", "Alistar"},
    "Senna":        {"Tahm Kench", "Sion", "Braum"},
    "Maokai":       {"Pyke", "Thresh", "Blitzcrank"},
    "Rakan":        {"Braum", "Karma", "Nautilus", "Pantheon", "Pyke"},
    "Neeko":        {"Alistar", "Braum", "Rakan", "Rell"},
    "Yasuo":        {"Akali", "Gnar", "Gwen", "Jayce", "Naafiri", "Ornn", "Taliyah"},
    "Yone":         {"Aurelion Sol", "Dr. Mundo", "Gwen", "Naafiri", "Sion"},
    "Akali":        {"Gnar", "Gwen", "Jax", "Naafiri", "Taliyah", "Viktor", "Volibear", "Yone"},
    "Ryze":         {"Akali"},
    "Sylas":        {"Malphite", "Alistar", "Ornn", "Ashe"},
}

# Draft sequence (solo mode)
DRAFT_SEQUENCE = [
    ("user",  "ban"),   # 0
    ("enemy", "ban"),   # 1
    ("user",  "ban"),   # 2
    ("enemy", "ban"),   # 3
    ("user",  "ban"),   # 4
    ("enemy", "ban"),   # 5
    ("user",  "pick"),  # 6
    ("enemy", "pick"),  # 7
    ("enemy", "pick"),  # 8
    ("user",  "pick"),  # 9
    ("user",  "pick"),  # 10
    ("enemy", "pick"),  # 11
    ("enemy", "ban"),   # 12
    ("user",  "ban"),   # 13
    ("enemy", "ban"),   # 14
    ("user",  "ban"),   # 15
    ("enemy", "pick"),  # 16
    ("user",  "pick"),  # 17
    ("user",  "pick"),  # 18
    ("enemy", "pick"),  # 19
]

# META_LOOKUP is populated at runtime by _rebuild_meta_lookup() in server.py
META_LOOKUP: dict = {}


def _get_team_champ_pool(team_id: str) -> set:
    if not team_id:
        return set()
    team = GAME_STATE["teams"].get(team_id, {})
    pool: set = set()
    for pid in team.get("roster", []):
        p = GAME_STATE["players"].get(pid, {})
        pool.update(p.get("champion_pool", []))
    return pool


def _get_team_champ_pool_by_pos(team_id: str) -> dict:
    if not team_id:
        return {}
    team = GAME_STATE["teams"].get(team_id, {})
    by_pos: dict = {}
    for pid in team.get("roster", []):
        p = GAME_STATE["players"].get(pid, {})
        pos = p.get("position", "")
        if pos:
            by_pos.setdefault(pos, set()).update(p.get("champion_pool", []))
    return by_pos


def _get_current_opponent_id() -> Optional[str]:
    user_id = GAME_STATE.get("user_team")
    week = GAME_STATE.get("current_week", 1)
    for m in GAME_STATE.get("schedule", []):
        if m.get("week") == week and not m.get("played"):
            if m["team1"] == user_id:
                return m["team2"]
            elif m["team2"] == user_id:
                return m["team1"]
    return None


def comp_score(picks: list) -> float:
    """Score a (partial) team composition [0-100] across five axes."""
    if not picks:
        return 0.0

    names = [p.get("champion", "") if isinstance(p, dict) else str(p) for p in picks]
    traits = [CHAMP_TRAITS.get(n, ("AD", 0, ())) for n in names]
    n = len(names)

    eff_ad = sum(1 if t[0] == "AD" else 0.5 if t[0] == "Mixed" else 0 for t in traits)
    eff_ap = sum(1 if t[0] == "AP" else 0.5 if t[0] == "Mixed" else 0 for t in traits)
    if n >= 3 and max(eff_ad, eff_ap) > 0:
        balance = min(eff_ad, eff_ap) / max(eff_ad, eff_ap)
        dmg_sc = balance * 25
    else:
        dmg_sc = 12.5

    total_cc = sum(t[1] for t in traits)
    eng_count = sum(1 for t in traits if "eng" in t[2])
    cc_sc = min(25.0, total_cc * 3.5 + eng_count * 1.5)

    name_set = set(names)
    syn_pts = sum(v for pair, v in SYNERGY_PAIRS if pair.issubset(name_set))
    syn_sc = min(20.0, syn_pts * 5.0)

    tier_pts = {"S": 4, "A": 3, "B": 2, "C": 1}
    avg_tier = sum(tier_pts.get(META_LOOKUP.get(nm, {}).get("tier", "C"), 1) for nm in names) / n
    meta_sc = min(20.0, avg_tier * 5.0)

    scalers = sum(1 for t in traits if "scl" in t[2])
    eg_champs = sum(1 for t in traits if "eg" in t[2])
    if scalers >= 2 and eg_champs >= 1:
        plan_sc = 10.0
    elif scalers >= 3:
        plan_sc = 8.0
    elif eg_champs >= 3:
        plan_sc = 6.0
    else:
        plan_sc = 4.0

    return dmg_sc + cc_sc + syn_sc + meta_sc + plan_sc


def delta_analyzer(
    candidate: str,
    pos: str,
    my_picks: list,
    enemy_picks: list,
    remaining_positions: list,
    draft_step: int,
) -> float:
    """Score how good it is to pick `candidate` at `pos` right now."""
    new_picks = my_picks + [{"champion": candidate, "position": pos}]
    comp_delta = comp_score(new_picks) - comp_score(my_picks)

    enemy_names = {p.get("champion", "") for p in enemy_picks}
    countered = COUNTER_MAP.get(candidate, set()) & enemy_names
    counter_val = len(countered) * 4.0

    primary_pos = META_LOOKUP.get(candidate, {}).get("position", "")
    role_fit = 3.0 if primary_pos == pos else -1.5

    tier = META_LOOKUP.get(candidate, {}).get("tier", "C")
    tier_val = {"S": 4, "A": 3, "B": 2, "C": 1}.get(tier, 1)

    if draft_step <= 5:
        seq = tier_val * 4.0 + comp_delta * 0.6
    elif draft_step <= 14:
        seq = comp_delta * 1.8 + tier_val * 1.5 + counter_val * 0.6
    else:
        seq = counter_val * 2.5 + comp_delta * 1.0 + tier_val * 0.8

    return seq + role_fit + counter_val


def calculate_draft_advantage(user_draft: dict, user_team_id: str, opponent_team_id: str) -> float:
    """Compute a draft advantage score [-12, +12]."""
    if not user_draft:
        return 0.0

    advantage = 0.0

    def _pick_name(p) -> str:
        if isinstance(p, dict):
            return p.get("champion", "") or ""
        return str(p) if p else ""

    def _pick_pos(p) -> str | None:
        if isinstance(p, dict):
            return p.get("position")
        return None

    def _ban_name(b) -> str:
        if isinstance(b, dict):
            return b.get("champion", "") or ""
        return str(b) if b else ""

    user_picks = user_draft.get("picks", []) or []
    draft_state = GAME_STATE.get("draft_state") or {}
    enemy_picks = user_draft.get("enemy_picks") or draft_state.get("enemy_picks", [])

    user_comp_sc = comp_score(user_picks)
    enemy_comp_sc = comp_score(enemy_picks)
    advantage += (user_comp_sc - enemy_comp_sc) / 8.0

    for pick in user_picks:
        meta = META_LOOKUP.get(_pick_name(pick), {})
        if meta.get("winrate", 0) > 55:
            advantage += 0.4
        elif meta.get("winrate", 0) < 45:
            advantage -= 0.2

    team = GAME_STATE["teams"].get(user_team_id, {})
    starters_by_pos: dict = {}
    for pid in team.get("roster", []):
        p = GAME_STATE["players"].get(pid, {})
        if p and p.get("is_starter"):
            starters_by_pos[p["position"]] = p

    for pick in user_picks:
        pos = _pick_pos(pick)
        if pos is None:
            continue
        player = starters_by_pos.get(pos)
        if player and _pick_name(pick) in player.get("champion_pool", []):
            advantage += 1.0

    opponent_pool = _get_team_champ_pool(opponent_team_id)
    for ban_raw in (user_draft.get("bans", []) or []):
        ban = _ban_name(ban_raw)
        if not ban:
            continue
        meta = META_LOOKUP.get(ban, {})
        tier = meta.get("tier", "C")
        if tier == "S" and ban in opponent_pool:
            advantage += 1.5
        elif tier == "A" and ban in opponent_pool:
            advantage += 0.5
        elif tier == "S":
            advantage += 0.3

    return max(-12.0, min(12.0, advantage))


def ai_select_ban(draft: dict, get_meta_champions_fn) -> Optional[str]:
    """Sequence-aware ban selection."""
    step = draft["step"]
    fearless = set(draft.get("fearless_excluded", []))
    unavailable = set(draft["banned_champions"] + draft["picked_champions"]) | fearless
    my_picks = [p.get("champion", "") for p in draft["enemy_picks"]]
    my_traits = [CHAMP_TRAITS.get(c, ("AD", 0, ())) for c in my_picks]

    opp_id = _get_current_opponent_id()
    opp_pool = _get_team_champ_pool(opp_id) if opp_id else set()
    opp_pool_by_pos = _get_team_champ_pool_by_pos(opp_id) if opp_id else {}

    opp_filled_positions = {p.get("position") for p in draft["user_picks"] if p.get("position")}
    opp_needed_positions = set(_needed_positions(draft, "user"))

    my_scalers = sum(1 for t in my_traits if "scl" in t[2])

    candidates = []
    for name, meta in META_LOOKUP.items():
        if name in unavailable:
            continue

        tier = meta.get("tier", "C")
        presence = meta.get("presence", 0.0)
        wr = meta.get("winrate", 50.0)
        pool_pos = next((pos for pos, champs in opp_pool_by_pos.items() if name in champs), None)
        champ_pos = pool_pos or meta.get("position", "")

        weight = presence * 0.4 + wr * 0.2
        weight += {"S": 18, "A": 9, "B": 3, "C": 0}.get(tier, 0)

        if champ_pos and champ_pos in opp_filled_positions:
            weight -= 20
        if champ_pos and champ_pos in opp_needed_positions:
            weight += 8

        if step <= 5:
            if name in opp_pool and champ_pos not in opp_filled_positions:
                weight += 22
        else:
            traits = CHAMP_TRAITS.get(name, ("AD", 0, ()))
            if my_scalers >= 2 and "eg" in traits[2]:
                weight += 12
            my_eng = sum(1 for t in my_traits if "eng" in t[2])
            if my_eng >= 2 and "dis" in traits[2]:
                weight += 8

        candidates.append((name, weight))

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[1], reverse=True)
    top = candidates[:10]
    weights = [max(0.1, c[1]) for c in top]
    total = sum(weights)
    r = random.uniform(0, total)
    running = 0.0
    for name, w in top:
        running += w
        if r <= running:
            return name
    return top[0][0]


def ai_select_pick(draft: dict, needed_positions: list, get_meta_champions_fn) -> tuple:
    """Delta-Analyzer based pick selection."""
    fearless = set(draft.get("fearless_excluded", []))
    unavailable = set(draft["banned_champions"] + draft["picked_champions"]) | fearless
    step = draft["step"]
    my_picks = draft["enemy_picks"]
    enemy_picks = draft["user_picks"]

    candidates = []
    for pos in needed_positions:
        for champ in get_meta_champions_fn().get(pos, []):
            name = champ["name"]
            if name in unavailable:
                continue
            score = delta_analyzer(name, pos, my_picks, enemy_picks, needed_positions, step)
            candidates.append((name, pos, score))

    if not candidates:
        for pos, champs in get_meta_champions_fn().items():
            for c in champs:
                if c["name"] not in unavailable:
                    return c["name"], pos
        return None, None

    candidates.sort(key=lambda x: x[2], reverse=True)
    top = candidates[:6]
    weights = [max(0.1, c[2] + 10) for c in top]
    total = sum(weights)
    r = random.uniform(0, total)
    running = 0.0
    for name, pos, w in top:
        running += w
        if r <= running:
            return name, pos
    return top[0][0], top[0][1]


def _needed_positions(draft: dict, actor: str) -> list:
    """Return positions not yet filled by `actor`."""
    all_positions = ["TOP", "JUNGLE", "MID", "ADC", "SUPPORT"]
    picks_key = "user_picks" if actor == "user" else "enemy_picks"
    filled = {p.get("position") for p in draft.get(picks_key, []) if p.get("position")}
    return [p for p in all_positions if p not in filled]
