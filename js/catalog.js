"use strict";
/* ============================================================================
 * PROJECT_CATALOG — static, read-only project-planning catalog.
 *
 * Each entry has the shape { catId, name, description, levels }.
 * Per-plan choices (on / from / to / first) are NOT stored here — they are set
 * when a user adds the project to their Shopping list (see addCatalogProject).
 *
 * TO REGENERATE / EXTEND from a fresh Forge save export, paste this into the
 * browser console with the export JSON in a variable `save`:
 *
 *   copy(JSON.stringify(save.projects.map(p=>({
 *     catId:p.id, name:p.name, description:p.description||"",
 *     levels:p.levels.map(L=>({costs:L.costs.map(c=>({item:c.item,qty:c.qty}))}))
 *   })),null,2));
 *
 * ...then paste the result as the PROJECT_CATALOG value below. Add new projects
 * by appending entries to the array.
 *
 * SCREEN-READ ENTRIES. the-tower-of-chad and biochemical-laboratory carry the
 * beta rebalance and were read off the in-game project screen, not a save
 * export. The screen shows the next level's cost while its counter shows the
 * levels already owned.
 *
 * BIOCHEMICAL LABORATORY CURVE — every item is a ×1.5 backbone off its own Lv 1
 * cost plus a surcharge the four items share in absolute terms:
 *
 *   cost(item,n) = base(item) · 1.5^(n-1) + e(n)
 *   base = RC 400, Batteries 100, Wire 400000, Frames 100000
 *   e(1..4) = 0, 150, 490, 1132.5, read at every item and exact at Batteries
 *
 * e(n)/1.5^(n-1) is linear across the read Lv 2–4, rising 1060/9 a level. Lv 5
 * keeps the backbone and continues that line: e(5) = 2295.
 *
 * ESTIMATED LEVELS. A few levels are too expensive to have been reached in game
 * yet, so their costs were extrapolated instead of read.
 * Every such entry says so in its `description`, which the catalog list shows:
 *
 *   biochemical-laboratory        Lv 5     its own curve, continued (see above)
 *   gym-and-relaxation-center-mk2 Lv 4     geometric mean of the read Lv 3 and Lv 5
 *   improved-silicate-scanner-mk2 Lv 5     ×5 per level, the project's own pattern
 *   the six backbone projects     Lv 36–48 the shared backbone curve, continued
 *   rig-parts-production-facility Lv 29–48 chained ×1.573, no in-game reading
 *   all-round-giga-scanner        Lv 31–48 ×1.573 from the read Lv 30
 *
 * Per-item steps differ within a project; estimates keep a whole-number step
 * exactly and round anything else to four significant figures.
 *
 * BACKBONE CURVE — finance-center, jade-refinery, hospital-wing,
 * off-rock-mining-operation, tokenium-mining-center, vespium-drill-hub:
 *
 *   b(n)  = 60 · 1.2^min(n-1,10) · 1.44^clamp(n-11,0,10) · 1.728^max(n-21,0)
 *   cost  = ceil(b(n) · share),  share ∈ 1, 5/6, 2/3, 1/2, 1/3, 1/4, 1/10, 1/12, 1/30
 *
 * The share applies to the unrounded b(n): entry 29 at 2/3 is
 * ceil(1132240.11 · 2/3) = 754827, not 754828. In-game readings at entries 32
 * and 33 fix the curve through entry 35.
 *
 * rig-parts-production-facility and all-round-giga-scanner use 1.3 / 1.43 /
 * 1.573 phasing. Rig Parts chains each item ×1.573 to the nearest 10 from entry
 * 29 — the precision of its capture. The Giga-Scanner's entry 30 is read (Wire
 * 290640, Gel 116256, Bits 5812800; Gel = 2/5 of Wire, Bits = 20×) and entries
 * 31+ chain the unrounded Wire, taking those shares from it.
 *
 * Replace an estimate with the read value as soon as the level is visible in
 * game, and drop the description note in the same change.
 * ========================================================================== */
const PROJECT_CATALOG_METADATA=Object.freeze({
  schemaVersion:1,
  status:"unverified",
  sourceType:"unknown",
  gameVersion:null,
  exportedAt:null,
  sourceSha256:null,
  updatedAt:null,
  verified:false
});
const PROJECT_CATALOG=[
  {
    "catId": "lunar-leisure-pavilion-mk3",
    "name": "Lunar Leisure Pavilion Mk. 3",
    "description": "Stamina + Ability CD",
    "levels": [
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 1200
          },
          {
            "item": "Glass",
            "qty": 140
          },
          {
            "item": "Plates",
            "qty": 600
          },
          {
            "item": "Frames",
            "qty": 0
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 1800
          },
          {
            "item": "Glass",
            "qty": 210
          },
          {
            "item": "Plates",
            "qty": 900
          },
          {
            "item": "Frames",
            "qty": 15
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 2700
          },
          {
            "item": "Glass",
            "qty": 315
          },
          {
            "item": "Plates",
            "qty": 1350
          },
          {
            "item": "Frames",
            "qty": 23
          },
          {
            "item": "Bricks",
            "qty": 90
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 13580
          },
          {
            "item": "Glass",
            "qty": 8209
          },
          {
            "item": "Plates",
            "qty": 10540
          },
          {
            "item": "Frames",
            "qty": 7551
          },
          {
            "item": "Bricks",
            "qty": 7703
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 61750
          },
          {
            "item": "Glass",
            "qty": 43640
          },
          {
            "item": "Plates",
            "qty": 51500
          },
          {
            "item": "Frames",
            "qty": 41420
          },
          {
            "item": "Bricks",
            "qty": 41930
          }
        ]
      }
    ]
  },
  {
    "catId": "waste-management-system",
    "name": "Waste Management System",
    "description": "Crafter Speed",
    "levels": [
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 1350
          },
          {
            "item": "Concrete",
            "qty": 1800
          },
          {
            "item": "Glass",
            "qty": 75
          },
          {
            "item": "Frames",
            "qty": 75
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 2025
          },
          {
            "item": "Concrete",
            "qty": 2700
          },
          {
            "item": "Glass",
            "qty": 113
          },
          {
            "item": "Frames",
            "qty": 113
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 3038
          },
          {
            "item": "Concrete",
            "qty": 4050
          },
          {
            "item": "Glass",
            "qty": 169
          },
          {
            "item": "Frames",
            "qty": 169
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 4557
          },
          {
            "item": "Concrete",
            "qty": 6075
          },
          {
            "item": "Glass",
            "qty": 254
          },
          {
            "item": "Frames",
            "qty": 254
          },
          {
            "item": "Reinforced Concrete",
            "qty": 7
          },
          {
            "item": "Batteries",
            "qty": 7
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 13670
          },
          {
            "item": "Concrete",
            "qty": 18230
          },
          {
            "item": "Glass",
            "qty": 760
          },
          {
            "item": "Frames",
            "qty": 760
          },
          {
            "item": "Reinforced Concrete",
            "qty": 21
          },
          {
            "item": "Batteries",
            "qty": 21
          }
        ]
      }
    ]
  },
  {
    "catId": "gym-and-relaxation-center-mk2",
    "name": "Gym and Relaxation Center Mk. 2",
    "description": "Stamina Recharge Rate & EXP · Lv 4 cost estimated",
    "levels": [
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 300
          },
          {
            "item": "Bricks",
            "qty": 100
          },
          {
            "item": "Plates",
            "qty": 250
          },
          {
            "item": "Rods",
            "qty": 250
          },
          {
            "item": "Frames",
            "qty": 10
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 450
          },
          {
            "item": "Bricks",
            "qty": 150
          },
          {
            "item": "Plates",
            "qty": 375
          },
          {
            "item": "Rods",
            "qty": 375
          },
          {
            "item": "Frames",
            "qty": 15
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 675
          },
          {
            "item": "Bricks",
            "qty": 225
          },
          {
            "item": "Plates",
            "qty": 563
          },
          {
            "item": "Rods",
            "qty": 563
          },
          {
            "item": "Frames",
            "qty": 23
          },
          {
            "item": "Concrete",
            "qty": 1125
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 5595
          },
          {
            "item": "Bricks",
            "qty": 3109
          },
          {
            "item": "Plates",
            "qty": 5062
          },
          {
            "item": "Rods",
            "qty": 5062
          },
          {
            "item": "Frames",
            "qty": 976
          },
          {
            "item": "Concrete",
            "qty": 7484
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 46380
          },
          {
            "item": "Bricks",
            "qty": 42960
          },
          {
            "item": "Plates",
            "qty": 45520
          },
          {
            "item": "Rods",
            "qty": 45520
          },
          {
            "item": "Frames",
            "qty": 41420
          },
          {
            "item": "Concrete",
            "qty": 49790
          }
        ]
      }
    ]
  },
  {
    "catId": "exotic-scanner-module",
    "name": "Exotic Scanner Module",
    "description": "Hydracite & Scorchium",
    "levels": [
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 2800
          },
          {
            "item": "Concrete",
            "qty": 1000
          },
          {
            "item": "Plates",
            "qty": 800
          },
          {
            "item": "Rods",
            "qty": 600
          },
          {
            "item": "Glass",
            "qty": 60
          },
          {
            "item": "Bricks",
            "qty": 100
          }
        ]
      }
    ]
  },
  {
    "catId": "internal-transportation-system",
    "name": "Internal Transportation System",
    "description": "All Resource gain",
    "levels": [
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 4800
          },
          {
            "item": "Concrete",
            "qty": 4800
          },
          {
            "item": "Glass",
            "qty": 360
          },
          {
            "item": "Bricks",
            "qty": 420
          },
          {
            "item": "Plates",
            "qty": 240
          },
          {
            "item": "Rods",
            "qty": 650
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 9600
          },
          {
            "item": "Concrete",
            "qty": 9600
          },
          {
            "item": "Glass",
            "qty": 720
          },
          {
            "item": "Bricks",
            "qty": 840
          },
          {
            "item": "Plates",
            "qty": 480
          },
          {
            "item": "Rods",
            "qty": 1300
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 19200
          },
          {
            "item": "Concrete",
            "qty": 19200
          },
          {
            "item": "Glass",
            "qty": 1440
          },
          {
            "item": "Bricks",
            "qty": 1680
          },
          {
            "item": "Plates",
            "qty": 960
          },
          {
            "item": "Rods",
            "qty": 2600
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 276800
          },
          {
            "item": "Concrete",
            "qty": 276800
          },
          {
            "item": "Glass",
            "qty": 205760
          },
          {
            "item": "Bricks",
            "qty": 206720
          },
          {
            "item": "Plates",
            "qty": 203840
          },
          {
            "item": "Rods",
            "qty": 210400
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 2210000
          },
          {
            "item": "Concrete",
            "qty": 2210000
          },
          {
            "item": "Glass",
            "qty": 1650000
          },
          {
            "item": "Bricks",
            "qty": 1650000
          },
          {
            "item": "Plates",
            "qty": 1630000
          },
          {
            "item": "Rods",
            "qty": 1680000
          }
        ]
      }
    ]
  },
  {
    "catId": "frame-factory",
    "name": "Frame Factory",
    "description": "Unlocks Vespium Frames",
    "levels": [
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 2560
          },
          {
            "item": "Concrete",
            "qty": 850
          },
          {
            "item": "Glass",
            "qty": 160
          },
          {
            "item": "Bricks",
            "qty": 120
          },
          {
            "item": "Plates",
            "qty": 325
          },
          {
            "item": "Rods",
            "qty": 375
          }
        ]
      }
    ]
  },
  {
    "catId": "mining-rig-factory-mk2",
    "name": "Mining Rig Factory Mk. 2",
    "description": "Tokenium Rig",
    "levels": [
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 3420
          },
          {
            "item": "Plates",
            "qty": 200
          },
          {
            "item": "Rods",
            "qty": 200
          },
          {
            "item": "Frames",
            "qty": 30
          }
        ]
      }
    ]
  },
  {
    "catId": "improved-vespium-scanner",
    "name": "Improved Vespium Scanner",
    "description": "",
    "levels": [
      {
        "costs": [
          {
            "item": "Rods",
            "qty": 80
          },
          {
            "item": "Plates",
            "qty": 0
          },
          {
            "item": "Frames",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Rods",
            "qty": 120
          },
          {
            "item": "Plates",
            "qty": 120
          },
          {
            "item": "Frames",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Rods",
            "qty": 180
          },
          {
            "item": "Plates",
            "qty": 180
          },
          {
            "item": "Frames",
            "qty": 23
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Rods",
            "qty": 270
          },
          {
            "item": "Plates",
            "qty": 270
          },
          {
            "item": "Frames",
            "qty": 34
          },
          {
            "item": "Batteries",
            "qty": 4
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Rods",
            "qty": 405
          },
          {
            "item": "Plates",
            "qty": 405
          },
          {
            "item": "Frames",
            "qty": 51
          },
          {
            "item": "Batteries",
            "qty": 6
          }
        ]
      }
    ]
  },
  {
    "catId": "finance-center",
    "name": "Finance Center",
    "description": "Lv 36–48 costs estimated",
    "levels": [
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 30
          },
          {
            "item": "Plates",
            "qty": 40
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 36
          },
          {
            "item": "Plates",
            "qty": 48
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 44
          },
          {
            "item": "Plates",
            "qty": 58
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 52
          },
          {
            "item": "Plates",
            "qty": 70
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 63
          },
          {
            "item": "Plates",
            "qty": 83
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 75
          },
          {
            "item": "Plates",
            "qty": 100
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 90
          },
          {
            "item": "Plates",
            "qty": 120
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 108
          },
          {
            "item": "Plates",
            "qty": 144
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 129
          },
          {
            "item": "Plates",
            "qty": 172
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 155
          },
          {
            "item": "Plates",
            "qty": 207
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 186
          },
          {
            "item": "Plates",
            "qty": 248
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 268
          },
          {
            "item": "Plates",
            "qty": 357
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 386
          },
          {
            "item": "Plates",
            "qty": 514
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 555
          },
          {
            "item": "Plates",
            "qty": 740
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 799
          },
          {
            "item": "Plates",
            "qty": 1065
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 1151
          },
          {
            "item": "Plates",
            "qty": 1534
          },
          {
            "item": "Bricks",
            "qty": 231
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 1657
          },
          {
            "item": "Plates",
            "qty": 2209
          },
          {
            "item": "Bricks",
            "qty": 332
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 2385
          },
          {
            "item": "Plates",
            "qty": 3180
          },
          {
            "item": "Bricks",
            "qty": 477
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 3435
          },
          {
            "item": "Plates",
            "qty": 4580
          },
          {
            "item": "Bricks",
            "qty": 687
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 4946
          },
          {
            "item": "Plates",
            "qty": 6594
          },
          {
            "item": "Bricks",
            "qty": 990
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 7122
          },
          {
            "item": "Plates",
            "qty": 9495
          },
          {
            "item": "Bricks",
            "qty": 1426
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 12307
          },
          {
            "item": "Plates",
            "qty": 16407
          },
          {
            "item": "Bricks",
            "qty": 2464
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 21266
          },
          {
            "item": "Plates",
            "qty": 28351
          },
          {
            "item": "Bricks",
            "qty": 4258
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 36748
          },
          {
            "item": "Plates",
            "qty": 48991
          },
          {
            "item": "Bricks",
            "qty": 7358
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 63501
          },
          {
            "item": "Plates",
            "qty": 84656
          },
          {
            "item": "Bricks",
            "qty": 12715
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 109730
          },
          {
            "item": "Plates",
            "qty": 146286
          },
          {
            "item": "Bricks",
            "qty": 21972
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 189613
          },
          {
            "item": "Plates",
            "qty": 252782
          },
          {
            "item": "Bricks",
            "qty": 37968
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 327651
          },
          {
            "item": "Plates",
            "qty": 436807
          },
          {
            "item": "Bricks",
            "qty": 65609
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 566121
          },
          {
            "item": "Plates",
            "qty": 754827
          },
          {
            "item": "Bricks",
            "qty": 113225
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 978256
          },
          {
            "item": "Plates",
            "qty": 1304341
          },
          {
            "item": "Bricks",
            "qty": 195652
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 1690426
          },
          {
            "item": "Plates",
            "qty": 2253901
          },
          {
            "item": "Bricks",
            "qty": 338086
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 2921056
          },
          {
            "item": "Plates",
            "qty": 3894741
          },
          {
            "item": "Bricks",
            "qty": 584212
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 5047584
          },
          {
            "item": "Plates",
            "qty": 6730112
          },
          {
            "item": "Bricks",
            "qty": 1009517
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 8722224
          },
          {
            "item": "Plates",
            "qty": 11629632
          },
          {
            "item": "Bricks",
            "qty": 1744445
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 15072003
          },
          {
            "item": "Plates",
            "qty": 20096004
          },
          {
            "item": "Bricks",
            "qty": 3014401
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 26044422
          },
          {
            "item": "Plates",
            "qty": 34725895
          },
          {
            "item": "Bricks",
            "qty": 5208885
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 45004760
          },
          {
            "item": "Plates",
            "qty": 60006347
          },
          {
            "item": "Bricks",
            "qty": 9000952
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 77768225
          },
          {
            "item": "Plates",
            "qty": 103690967
          },
          {
            "item": "Bricks",
            "qty": 15553645
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 134383493
          },
          {
            "item": "Plates",
            "qty": 179177990
          },
          {
            "item": "Bricks",
            "qty": 26876699
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 232214675
          },
          {
            "item": "Plates",
            "qty": 309619566
          },
          {
            "item": "Bricks",
            "qty": 46442935
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 401266958
          },
          {
            "item": "Plates",
            "qty": 535022610
          },
          {
            "item": "Bricks",
            "qty": 80253392
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 693389303
          },
          {
            "item": "Plates",
            "qty": 924519071
          },
          {
            "item": "Bricks",
            "qty": 138677861
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 1198176715
          },
          {
            "item": "Plates",
            "qty": 1597568953
          },
          {
            "item": "Bricks",
            "qty": 239635343
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 2070449364
          },
          {
            "item": "Plates",
            "qty": 2760599151
          },
          {
            "item": "Bricks",
            "qty": 414089873
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 3577736500
          },
          {
            "item": "Plates",
            "qty": 4770315333
          },
          {
            "item": "Bricks",
            "qty": 715547300
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 6182328671
          },
          {
            "item": "Plates",
            "qty": 8243104895
          },
          {
            "item": "Bricks",
            "qty": 1236465735
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 10683063944
          },
          {
            "item": "Plates",
            "qty": 14244085258
          },
          {
            "item": "Bricks",
            "qty": 2136612789
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 18460334494
          },
          {
            "item": "Plates",
            "qty": 24613779326
          },
          {
            "item": "Bricks",
            "qty": 3692066899
          }
        ]
      }
    ]
  },
  {
    "catId": "jade-refinery",
    "name": "Jade Refinery",
    "description": "Lv 36–48 costs estimated",
    "levels": [
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 60
          },
          {
            "item": "Rods",
            "qty": 40
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 72
          },
          {
            "item": "Rods",
            "qty": 48
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 87
          },
          {
            "item": "Rods",
            "qty": 58
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 104
          },
          {
            "item": "Rods",
            "qty": 70
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 125
          },
          {
            "item": "Rods",
            "qty": 83
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 150
          },
          {
            "item": "Rods",
            "qty": 100
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 180
          },
          {
            "item": "Rods",
            "qty": 120
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 215
          },
          {
            "item": "Rods",
            "qty": 144
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 258
          },
          {
            "item": "Rods",
            "qty": 172
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 310
          },
          {
            "item": "Rods",
            "qty": 207
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 372
          },
          {
            "item": "Rods",
            "qty": 248
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 535
          },
          {
            "item": "Rods",
            "qty": 357
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 771
          },
          {
            "item": "Rods",
            "qty": 514
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 1110
          },
          {
            "item": "Rods",
            "qty": 740
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 1598
          },
          {
            "item": "Rods",
            "qty": 1065
          },
          {
            "item": "Plates",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 2301
          },
          {
            "item": "Rods",
            "qty": 1534
          },
          {
            "item": "Plates",
            "qty": 767
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 3313
          },
          {
            "item": "Rods",
            "qty": 2209
          },
          {
            "item": "Plates",
            "qty": 1105
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 4770
          },
          {
            "item": "Rods",
            "qty": 3180
          },
          {
            "item": "Plates",
            "qty": 1590
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 6869
          },
          {
            "item": "Rods",
            "qty": 4580
          },
          {
            "item": "Plates",
            "qty": 2290
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 9891
          },
          {
            "item": "Rods",
            "qty": 6594
          },
          {
            "item": "Plates",
            "qty": 3297
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 14243
          },
          {
            "item": "Rods",
            "qty": 9495
          },
          {
            "item": "Plates",
            "qty": 4748
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 24612
          },
          {
            "item": "Rods",
            "qty": 16407
          },
          {
            "item": "Plates",
            "qty": 8205
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 42530
          },
          {
            "item": "Rods",
            "qty": 28351
          },
          {
            "item": "Plates",
            "qty": 14178
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 73492
          },
          {
            "item": "Rods",
            "qty": 48991
          },
          {
            "item": "Plates",
            "qty": 24500
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 126994
          },
          {
            "item": "Rods",
            "qty": 84656
          },
          {
            "item": "Plates",
            "qty": 42336
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 219446
          },
          {
            "item": "Rods",
            "qty": 146286
          },
          {
            "item": "Plates",
            "qty": 73157
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 379203
          },
          {
            "item": "Rods",
            "qty": 252782
          },
          {
            "item": "Plates",
            "qty": 126415
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 655263
          },
          {
            "item": "Rods",
            "qty": 436807
          },
          {
            "item": "Plates",
            "qty": 218445
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 1132241
          },
          {
            "item": "Rods",
            "qty": 754827
          },
          {
            "item": "Plates",
            "qty": 377414
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 1956511
          },
          {
            "item": "Rods",
            "qty": 1304341
          },
          {
            "item": "Plates",
            "qty": 652171
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 3380851
          },
          {
            "item": "Rods",
            "qty": 2253901
          },
          {
            "item": "Plates",
            "qty": 1126951
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 5842111
          },
          {
            "item": "Rods",
            "qty": 3894741
          },
          {
            "item": "Plates",
            "qty": 1947371
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 10095167
          },
          {
            "item": "Rods",
            "qty": 6730112
          },
          {
            "item": "Plates",
            "qty": 3365056
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 17444448
          },
          {
            "item": "Rods",
            "qty": 11629632
          },
          {
            "item": "Plates",
            "qty": 5814816
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 30144006
          },
          {
            "item": "Rods",
            "qty": 20096004
          },
          {
            "item": "Plates",
            "qty": 10048002
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 52088843
          },
          {
            "item": "Rods",
            "qty": 34725895
          },
          {
            "item": "Plates",
            "qty": 17362948
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 90009520
          },
          {
            "item": "Rods",
            "qty": 60006347
          },
          {
            "item": "Plates",
            "qty": 30003174
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 155536450
          },
          {
            "item": "Rods",
            "qty": 103690967
          },
          {
            "item": "Plates",
            "qty": 51845484
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 268766985
          },
          {
            "item": "Rods",
            "qty": 179177990
          },
          {
            "item": "Plates",
            "qty": 89588995
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 464429349
          },
          {
            "item": "Rods",
            "qty": 309619566
          },
          {
            "item": "Plates",
            "qty": 154809783
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 802533915
          },
          {
            "item": "Rods",
            "qty": 535022610
          },
          {
            "item": "Plates",
            "qty": 267511305
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 1386778606
          },
          {
            "item": "Rods",
            "qty": 924519071
          },
          {
            "item": "Plates",
            "qty": 462259536
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 2396353430
          },
          {
            "item": "Rods",
            "qty": 1597568953
          },
          {
            "item": "Plates",
            "qty": 798784477
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 4140898727
          },
          {
            "item": "Rods",
            "qty": 2760599151
          },
          {
            "item": "Plates",
            "qty": 1380299576
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 7155472999
          },
          {
            "item": "Rods",
            "qty": 4770315333
          },
          {
            "item": "Plates",
            "qty": 2385157667
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 12364657342
          },
          {
            "item": "Rods",
            "qty": 8243104895
          },
          {
            "item": "Plates",
            "qty": 4121552448
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 21366127887
          },
          {
            "item": "Rods",
            "qty": 14244085258
          },
          {
            "item": "Plates",
            "qty": 7122042629
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 36920668988
          },
          {
            "item": "Rods",
            "qty": 24613779326
          },
          {
            "item": "Plates",
            "qty": 12306889663
          }
        ]
      }
    ]
  },
  {
    "catId": "hospital-wing",
    "name": "Hospital Wing",
    "description": "Lv 36–48 costs estimated",
    "levels": [
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 60
          },
          {
            "item": "Glass",
            "qty": 5
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 72
          },
          {
            "item": "Glass",
            "qty": 6
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 87
          },
          {
            "item": "Glass",
            "qty": 8
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 104
          },
          {
            "item": "Glass",
            "qty": 9
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 125
          },
          {
            "item": "Glass",
            "qty": 11
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 150
          },
          {
            "item": "Glass",
            "qty": 13
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 180
          },
          {
            "item": "Glass",
            "qty": 15
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 215
          },
          {
            "item": "Glass",
            "qty": 18
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 258
          },
          {
            "item": "Glass",
            "qty": 22
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 310
          },
          {
            "item": "Glass",
            "qty": 26
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 372
          },
          {
            "item": "Glass",
            "qty": 31
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 535
          },
          {
            "item": "Glass",
            "qty": 45
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 771
          },
          {
            "item": "Glass",
            "qty": 65
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 1110
          },
          {
            "item": "Glass",
            "qty": 93
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 1598
          },
          {
            "item": "Glass",
            "qty": 134
          },
          {
            "item": "Bricks",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 2301
          },
          {
            "item": "Glass",
            "qty": 192
          },
          {
            "item": "Bricks",
            "qty": 77
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 3313
          },
          {
            "item": "Glass",
            "qty": 277
          },
          {
            "item": "Bricks",
            "qty": 111
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 4770
          },
          {
            "item": "Glass",
            "qty": 398
          },
          {
            "item": "Bricks",
            "qty": 159
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 6869
          },
          {
            "item": "Glass",
            "qty": 573
          },
          {
            "item": "Bricks",
            "qty": 229
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 9891
          },
          {
            "item": "Glass",
            "qty": 825
          },
          {
            "item": "Bricks",
            "qty": 330
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 14243
          },
          {
            "item": "Glass",
            "qty": 1188
          },
          {
            "item": "Bricks",
            "qty": 475
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 24612
          },
          {
            "item": "Glass",
            "qty": 2053
          },
          {
            "item": "Bricks",
            "qty": 821
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 42530
          },
          {
            "item": "Glass",
            "qty": 3548
          },
          {
            "item": "Bricks",
            "qty": 1419
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 73492
          },
          {
            "item": "Glass",
            "qty": 6131
          },
          {
            "item": "Bricks",
            "qty": 2452
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 126994
          },
          {
            "item": "Glass",
            "qty": 10594
          },
          {
            "item": "Bricks",
            "qty": 4237
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 219446
          },
          {
            "item": "Glass",
            "qty": 18306
          },
          {
            "item": "Bricks",
            "qty": 7322
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 379203
          },
          {
            "item": "Glass",
            "qty": 31633
          },
          {
            "item": "Bricks",
            "qty": 12652
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 655263
          },
          {
            "item": "Glass",
            "qty": 54662
          },
          {
            "item": "Bricks",
            "qty": 21863
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 1132241
          },
          {
            "item": "Glass",
            "qty": 94354
          },
          {
            "item": "Bricks",
            "qty": 37742
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 1956511
          },
          {
            "item": "Glass",
            "qty": 163043
          },
          {
            "item": "Bricks",
            "qty": 65218
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 3380851
          },
          {
            "item": "Glass",
            "qty": 281738
          },
          {
            "item": "Bricks",
            "qty": 112696
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 5842111
          },
          {
            "item": "Glass",
            "qty": 486843
          },
          {
            "item": "Bricks",
            "qty": 194738
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 10095167
          },
          {
            "item": "Glass",
            "qty": 841264
          },
          {
            "item": "Bricks",
            "qty": 336506
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 17444448
          },
          {
            "item": "Glass",
            "qty": 1453704
          },
          {
            "item": "Bricks",
            "qty": 581482
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 30144006
          },
          {
            "item": "Glass",
            "qty": 2512001
          },
          {
            "item": "Bricks",
            "qty": 1004801
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 52088843
          },
          {
            "item": "Glass",
            "qty": 4340737
          },
          {
            "item": "Bricks",
            "qty": 1736295
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 90009520
          },
          {
            "item": "Glass",
            "qty": 7500794
          },
          {
            "item": "Bricks",
            "qty": 3000318
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 155536450
          },
          {
            "item": "Glass",
            "qty": 12961371
          },
          {
            "item": "Bricks",
            "qty": 5184549
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 268766985
          },
          {
            "item": "Glass",
            "qty": 22397249
          },
          {
            "item": "Bricks",
            "qty": 8958900
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 464429349
          },
          {
            "item": "Glass",
            "qty": 38702446
          },
          {
            "item": "Bricks",
            "qty": 15480979
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 802533915
          },
          {
            "item": "Glass",
            "qty": 66877827
          },
          {
            "item": "Bricks",
            "qty": 26751131
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 1386778606
          },
          {
            "item": "Glass",
            "qty": 115564884
          },
          {
            "item": "Bricks",
            "qty": 46225954
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 2396353430
          },
          {
            "item": "Glass",
            "qty": 199696120
          },
          {
            "item": "Bricks",
            "qty": 79878448
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 4140898727
          },
          {
            "item": "Glass",
            "qty": 345074894
          },
          {
            "item": "Bricks",
            "qty": 138029958
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 7155472999
          },
          {
            "item": "Glass",
            "qty": 596289417
          },
          {
            "item": "Bricks",
            "qty": 238515767
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 12364657342
          },
          {
            "item": "Glass",
            "qty": 1030388112
          },
          {
            "item": "Bricks",
            "qty": 412155245
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 21366127887
          },
          {
            "item": "Glass",
            "qty": 1780510658
          },
          {
            "item": "Bricks",
            "qty": 712204263
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 36920668988
          },
          {
            "item": "Glass",
            "qty": 3076722416
          },
          {
            "item": "Bricks",
            "qty": 1230688967
          }
        ]
      }
    ]
  },
  {
    "catId": "off-rock-mining-operation",
    "name": "Off-Rock Mining Operation",
    "description": "Lv 36–48 costs estimated",
    "levels": [
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 60
          },
          {
            "item": "Rods",
            "qty": 40
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 72
          },
          {
            "item": "Rods",
            "qty": 48
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 87
          },
          {
            "item": "Rods",
            "qty": 58
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 104
          },
          {
            "item": "Rods",
            "qty": 70
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 125
          },
          {
            "item": "Rods",
            "qty": 83
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 150
          },
          {
            "item": "Rods",
            "qty": 100
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 180
          },
          {
            "item": "Rods",
            "qty": 120
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 215
          },
          {
            "item": "Rods",
            "qty": 144
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 258
          },
          {
            "item": "Rods",
            "qty": 172
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 310
          },
          {
            "item": "Rods",
            "qty": 207
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 372
          },
          {
            "item": "Rods",
            "qty": 248
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 535
          },
          {
            "item": "Rods",
            "qty": 357
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 771
          },
          {
            "item": "Rods",
            "qty": 514
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 1110
          },
          {
            "item": "Rods",
            "qty": 740
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 1598
          },
          {
            "item": "Rods",
            "qty": 1065
          },
          {
            "item": "Concrete",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 2301
          },
          {
            "item": "Rods",
            "qty": 1534
          },
          {
            "item": "Concrete",
            "qty": 1917
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 3313
          },
          {
            "item": "Rods",
            "qty": 2209
          },
          {
            "item": "Concrete",
            "qty": 2761
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 4770
          },
          {
            "item": "Rods",
            "qty": 3180
          },
          {
            "item": "Concrete",
            "qty": 3975
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 6869
          },
          {
            "item": "Rods",
            "qty": 4580
          },
          {
            "item": "Concrete",
            "qty": 5724
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 9891
          },
          {
            "item": "Rods",
            "qty": 6594
          },
          {
            "item": "Concrete",
            "qty": 8243
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 14243
          },
          {
            "item": "Rods",
            "qty": 9495
          },
          {
            "item": "Concrete",
            "qty": 11870
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 24612
          },
          {
            "item": "Rods",
            "qty": 16407
          },
          {
            "item": "Concrete",
            "qty": 20511
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 42530
          },
          {
            "item": "Rods",
            "qty": 28351
          },
          {
            "item": "Concrete",
            "qty": 35443
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 73492
          },
          {
            "item": "Rods",
            "qty": 48991
          },
          {
            "item": "Concrete",
            "qty": 61246
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 126994
          },
          {
            "item": "Rods",
            "qty": 84656
          },
          {
            "item": "Concrete",
            "qty": 105833
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 219446
          },
          {
            "item": "Rods",
            "qty": 146286
          },
          {
            "item": "Concrete",
            "qty": 182879
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 379203
          },
          {
            "item": "Rods",
            "qty": 252782
          },
          {
            "item": "Concrete",
            "qty": 316015
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 655263
          },
          {
            "item": "Rods",
            "qty": 436807
          },
          {
            "item": "Concrete",
            "qty": 546074
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 1132241
          },
          {
            "item": "Rods",
            "qty": 754827
          },
          {
            "item": "Concrete",
            "qty": 943534
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 1956511
          },
          {
            "item": "Rods",
            "qty": 1304341
          },
          {
            "item": "Concrete",
            "qty": 1630426
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 3380851
          },
          {
            "item": "Rods",
            "qty": 2253901
          },
          {
            "item": "Concrete",
            "qty": 2817376
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 5842111
          },
          {
            "item": "Rods",
            "qty": 3894741
          },
          {
            "item": "Concrete",
            "qty": 4868426
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 10095167
          },
          {
            "item": "Rods",
            "qty": 6730112
          },
          {
            "item": "Concrete",
            "qty": 8412639
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 17444448
          },
          {
            "item": "Rods",
            "qty": 11629632
          },
          {
            "item": "Concrete",
            "qty": 14537040
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 30144006
          },
          {
            "item": "Rods",
            "qty": 20096004
          },
          {
            "item": "Concrete",
            "qty": 25120005
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 52088843
          },
          {
            "item": "Rods",
            "qty": 34725895
          },
          {
            "item": "Concrete",
            "qty": 43407369
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 90009520
          },
          {
            "item": "Rods",
            "qty": 60006347
          },
          {
            "item": "Concrete",
            "qty": 75007933
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 155536450
          },
          {
            "item": "Rods",
            "qty": 103690967
          },
          {
            "item": "Concrete",
            "qty": 129613708
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 268766985
          },
          {
            "item": "Rods",
            "qty": 179177990
          },
          {
            "item": "Concrete",
            "qty": 223972487
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 464429349
          },
          {
            "item": "Rods",
            "qty": 309619566
          },
          {
            "item": "Concrete",
            "qty": 387024458
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 802533915
          },
          {
            "item": "Rods",
            "qty": 535022610
          },
          {
            "item": "Concrete",
            "qty": 668778263
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 1386778606
          },
          {
            "item": "Rods",
            "qty": 924519071
          },
          {
            "item": "Concrete",
            "qty": 1155648838
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 2396353430
          },
          {
            "item": "Rods",
            "qty": 1597568953
          },
          {
            "item": "Concrete",
            "qty": 1996961192
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 4140898727
          },
          {
            "item": "Rods",
            "qty": 2760599151
          },
          {
            "item": "Concrete",
            "qty": 3450748939
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 7155472999
          },
          {
            "item": "Rods",
            "qty": 4770315333
          },
          {
            "item": "Concrete",
            "qty": 5962894166
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 12364657342
          },
          {
            "item": "Rods",
            "qty": 8243104895
          },
          {
            "item": "Concrete",
            "qty": 10303881119
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 21366127887
          },
          {
            "item": "Rods",
            "qty": 14244085258
          },
          {
            "item": "Concrete",
            "qty": 17805106573
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 36920668988
          },
          {
            "item": "Rods",
            "qty": 24613779326
          },
          {
            "item": "Concrete",
            "qty": 30767224157
          }
        ]
      }
    ]
  },
  {
    "catId": "tokenium-mining-center",
    "name": "Tokenium Mining Center",
    "description": "Lv 36–48 costs estimated",
    "levels": [
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 60
          },
          {
            "item": "Bricks",
            "qty": 20
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 72
          },
          {
            "item": "Bricks",
            "qty": 24
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 87
          },
          {
            "item": "Bricks",
            "qty": 29
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 104
          },
          {
            "item": "Bricks",
            "qty": 35
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 125
          },
          {
            "item": "Bricks",
            "qty": 42
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 150
          },
          {
            "item": "Bricks",
            "qty": 50
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 180
          },
          {
            "item": "Bricks",
            "qty": 60
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 215
          },
          {
            "item": "Bricks",
            "qty": 72
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 258
          },
          {
            "item": "Bricks",
            "qty": 86
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 310
          },
          {
            "item": "Bricks",
            "qty": 104
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 372
          },
          {
            "item": "Bricks",
            "qty": 124
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 535
          },
          {
            "item": "Bricks",
            "qty": 179
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 771
          },
          {
            "item": "Bricks",
            "qty": 257
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 1110
          },
          {
            "item": "Bricks",
            "qty": 370
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 1598
          },
          {
            "item": "Bricks",
            "qty": 533
          },
          {
            "item": "Glass",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 2301
          },
          {
            "item": "Bricks",
            "qty": 767
          },
          {
            "item": "Glass",
            "qty": 192
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 3313
          },
          {
            "item": "Bricks",
            "qty": 1105
          },
          {
            "item": "Glass",
            "qty": 277
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 4770
          },
          {
            "item": "Bricks",
            "qty": 1590
          },
          {
            "item": "Glass",
            "qty": 398
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 6869
          },
          {
            "item": "Bricks",
            "qty": 2290
          },
          {
            "item": "Glass",
            "qty": 573
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 9891
          },
          {
            "item": "Bricks",
            "qty": 3297
          },
          {
            "item": "Glass",
            "qty": 825
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 14243
          },
          {
            "item": "Bricks",
            "qty": 4748
          },
          {
            "item": "Glass",
            "qty": 1188
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 24612
          },
          {
            "item": "Bricks",
            "qty": 8205
          },
          {
            "item": "Glass",
            "qty": 2053
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 42530
          },
          {
            "item": "Bricks",
            "qty": 14178
          },
          {
            "item": "Glass",
            "qty": 3548
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 73492
          },
          {
            "item": "Bricks",
            "qty": 24500
          },
          {
            "item": "Glass",
            "qty": 6131
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 126994
          },
          {
            "item": "Bricks",
            "qty": 42336
          },
          {
            "item": "Glass",
            "qty": 10594
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 219446
          },
          {
            "item": "Bricks",
            "qty": 73157
          },
          {
            "item": "Glass",
            "qty": 18306
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 379203
          },
          {
            "item": "Bricks",
            "qty": 126415
          },
          {
            "item": "Glass",
            "qty": 31633
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 655263
          },
          {
            "item": "Bricks",
            "qty": 218445
          },
          {
            "item": "Glass",
            "qty": 54662
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 1132241
          },
          {
            "item": "Bricks",
            "qty": 377414
          },
          {
            "item": "Glass",
            "qty": 94354
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 1956511
          },
          {
            "item": "Bricks",
            "qty": 652171
          },
          {
            "item": "Glass",
            "qty": 163043
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 3380851
          },
          {
            "item": "Bricks",
            "qty": 1126951
          },
          {
            "item": "Glass",
            "qty": 281738
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 5842111
          },
          {
            "item": "Bricks",
            "qty": 1947371
          },
          {
            "item": "Glass",
            "qty": 486843
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 10095167
          },
          {
            "item": "Bricks",
            "qty": 3365056
          },
          {
            "item": "Glass",
            "qty": 841264
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 17444448
          },
          {
            "item": "Bricks",
            "qty": 5814816
          },
          {
            "item": "Glass",
            "qty": 1453704
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 30144006
          },
          {
            "item": "Bricks",
            "qty": 10048002
          },
          {
            "item": "Glass",
            "qty": 2512001
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 52088843
          },
          {
            "item": "Bricks",
            "qty": 17362948
          },
          {
            "item": "Glass",
            "qty": 4340737
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 90009520
          },
          {
            "item": "Bricks",
            "qty": 30003174
          },
          {
            "item": "Glass",
            "qty": 7500794
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 155536450
          },
          {
            "item": "Bricks",
            "qty": 51845484
          },
          {
            "item": "Glass",
            "qty": 12961371
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 268766985
          },
          {
            "item": "Bricks",
            "qty": 89588995
          },
          {
            "item": "Glass",
            "qty": 22397249
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 464429349
          },
          {
            "item": "Bricks",
            "qty": 154809783
          },
          {
            "item": "Glass",
            "qty": 38702446
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 802533915
          },
          {
            "item": "Bricks",
            "qty": 267511305
          },
          {
            "item": "Glass",
            "qty": 66877827
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 1386778606
          },
          {
            "item": "Bricks",
            "qty": 462259536
          },
          {
            "item": "Glass",
            "qty": 115564884
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 2396353430
          },
          {
            "item": "Bricks",
            "qty": 798784477
          },
          {
            "item": "Glass",
            "qty": 199696120
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 4140898727
          },
          {
            "item": "Bricks",
            "qty": 1380299576
          },
          {
            "item": "Glass",
            "qty": 345074894
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 7155472999
          },
          {
            "item": "Bricks",
            "qty": 2385157667
          },
          {
            "item": "Glass",
            "qty": 596289417
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 12364657342
          },
          {
            "item": "Bricks",
            "qty": 4121552448
          },
          {
            "item": "Glass",
            "qty": 1030388112
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 21366127887
          },
          {
            "item": "Bricks",
            "qty": 7122042629
          },
          {
            "item": "Glass",
            "qty": 1780510658
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 36920668988
          },
          {
            "item": "Bricks",
            "qty": 12306889663
          },
          {
            "item": "Glass",
            "qty": 3076722416
          }
        ]
      }
    ]
  },
  {
    "catId": "vespium-drill-hub",
    "name": "Vespium Drill Hub",
    "description": "Lv 36–48 costs estimated",
    "levels": [
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 15
          },
          {
            "item": "Plates",
            "qty": 40
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 18
          },
          {
            "item": "Plates",
            "qty": 48
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 22
          },
          {
            "item": "Plates",
            "qty": 58
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 26
          },
          {
            "item": "Plates",
            "qty": 70
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 32
          },
          {
            "item": "Plates",
            "qty": 83
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 38
          },
          {
            "item": "Plates",
            "qty": 100
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 45
          },
          {
            "item": "Plates",
            "qty": 120
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 54
          },
          {
            "item": "Plates",
            "qty": 144
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 65
          },
          {
            "item": "Plates",
            "qty": 172
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 78
          },
          {
            "item": "Plates",
            "qty": 207
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 93
          },
          {
            "item": "Plates",
            "qty": 248
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 134
          },
          {
            "item": "Plates",
            "qty": 357
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 193
          },
          {
            "item": "Plates",
            "qty": 514
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 278
          },
          {
            "item": "Plates",
            "qty": 740
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 400
          },
          {
            "item": "Plates",
            "qty": 1065
          },
          {
            "item": "Bits",
            "qty": 0
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 576
          },
          {
            "item": "Plates",
            "qty": 1534
          },
          {
            "item": "Bits",
            "qty": 1917
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 829
          },
          {
            "item": "Plates",
            "qty": 2209
          },
          {
            "item": "Bits",
            "qty": 2761
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 1193
          },
          {
            "item": "Plates",
            "qty": 3180
          },
          {
            "item": "Bits",
            "qty": 3975
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 1718
          },
          {
            "item": "Plates",
            "qty": 4580
          },
          {
            "item": "Bits",
            "qty": 5724
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 2473
          },
          {
            "item": "Plates",
            "qty": 6594
          },
          {
            "item": "Bits",
            "qty": 8243
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 3561
          },
          {
            "item": "Plates",
            "qty": 9495
          },
          {
            "item": "Bits",
            "qty": 11870
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 6153
          },
          {
            "item": "Plates",
            "qty": 16407
          },
          {
            "item": "Bits",
            "qty": 20511
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 10632
          },
          {
            "item": "Plates",
            "qty": 28351
          },
          {
            "item": "Bits",
            "qty": 35443
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 18372
          },
          {
            "item": "Plates",
            "qty": 48991
          },
          {
            "item": "Bits",
            "qty": 61246
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 31747
          },
          {
            "item": "Plates",
            "qty": 84656
          },
          {
            "item": "Bits",
            "qty": 105833
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 54859
          },
          {
            "item": "Plates",
            "qty": 146286
          },
          {
            "item": "Bits",
            "qty": 182879
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 94796
          },
          {
            "item": "Plates",
            "qty": 252782
          },
          {
            "item": "Bits",
            "qty": 316015
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 163807
          },
          {
            "item": "Plates",
            "qty": 436807
          },
          {
            "item": "Bits",
            "qty": 546074
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 283061
          },
          {
            "item": "Plates",
            "qty": 754827
          },
          {
            "item": "Bits",
            "qty": 943534
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 489128
          },
          {
            "item": "Plates",
            "qty": 1304341
          },
          {
            "item": "Bits",
            "qty": 1630426
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 845213
          },
          {
            "item": "Plates",
            "qty": 2253901
          },
          {
            "item": "Bits",
            "qty": 2817376
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 1460528
          },
          {
            "item": "Plates",
            "qty": 3894741
          },
          {
            "item": "Bits",
            "qty": 4868426
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 2523792
          },
          {
            "item": "Plates",
            "qty": 6730112
          },
          {
            "item": "Bits",
            "qty": 8412639
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 4361112
          },
          {
            "item": "Plates",
            "qty": 11629632
          },
          {
            "item": "Bits",
            "qty": 14537040
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 7536002
          },
          {
            "item": "Plates",
            "qty": 20096004
          },
          {
            "item": "Bits",
            "qty": 25120005
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 13022211
          },
          {
            "item": "Plates",
            "qty": 34725895
          },
          {
            "item": "Bits",
            "qty": 43407369
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 22502380
          },
          {
            "item": "Plates",
            "qty": 60006347
          },
          {
            "item": "Bits",
            "qty": 75007933
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 38884113
          },
          {
            "item": "Plates",
            "qty": 103690967
          },
          {
            "item": "Bits",
            "qty": 129613708
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 67191747
          },
          {
            "item": "Plates",
            "qty": 179177990
          },
          {
            "item": "Bits",
            "qty": 223972487
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 116107338
          },
          {
            "item": "Plates",
            "qty": 309619566
          },
          {
            "item": "Bits",
            "qty": 387024458
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 200633479
          },
          {
            "item": "Plates",
            "qty": 535022610
          },
          {
            "item": "Bits",
            "qty": 668778263
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 346694652
          },
          {
            "item": "Plates",
            "qty": 924519071
          },
          {
            "item": "Bits",
            "qty": 1155648838
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 599088358
          },
          {
            "item": "Plates",
            "qty": 1597568953
          },
          {
            "item": "Bits",
            "qty": 1996961192
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 1035224682
          },
          {
            "item": "Plates",
            "qty": 2760599151
          },
          {
            "item": "Bits",
            "qty": 3450748939
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 1788868250
          },
          {
            "item": "Plates",
            "qty": 4770315333
          },
          {
            "item": "Bits",
            "qty": 5962894166
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 3091164336
          },
          {
            "item": "Plates",
            "qty": 8243104895
          },
          {
            "item": "Bits",
            "qty": 10303881119
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 5341531972
          },
          {
            "item": "Plates",
            "qty": 14244085258
          },
          {
            "item": "Bits",
            "qty": 17805106573
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 9230167247
          },
          {
            "item": "Plates",
            "qty": 24613779326
          },
          {
            "item": "Bits",
            "qty": 30767224157
          }
        ]
      }
    ]
  },
  {
    "catId": "mining-rig-factory-mk3",
    "name": "Mining Rig Factory Mk. 3",
    "description": "Vespium Rig",
    "levels": [
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 10000
          },
          {
            "item": "Plates",
            "qty": 4000
          },
          {
            "item": "Rods",
            "qty": 4000
          },
          {
            "item": "Frames",
            "qty": 300
          }
        ]
      }
    ]
  },
  {
    "catId": "vescas-workshop-mk2",
    "name": "Vesca's Workshop Mk. 2",
    "description": "",
    "levels": [
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 1000
          },
          {
            "item": "Plates",
            "qty": 2500
          },
          {
            "item": "Rods",
            "qty": 1000
          },
          {
            "item": "Frames",
            "qty": 200
          }
        ]
      }
    ]
  },
  {
    "catId": "gel-refinery",
    "name": "Gel Refinery",
    "description": "",
    "levels": [
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 50000
          },
          {
            "item": "Glass",
            "qty": 300
          },
          {
            "item": "Plates",
            "qty": 600
          },
          {
            "item": "Frames",
            "qty": 60
          },
          {
            "item": "Bricks",
            "qty": 100
          }
        ]
      }
    ]
  },
  {
    "catId": "wire-tower",
    "name": "Wire Tower",
    "description": "",
    "levels": [
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 500
          },
          {
            "item": "Bricks",
            "qty": 400
          },
          {
            "item": "Plates",
            "qty": 1000
          },
          {
            "item": "Frames",
            "qty": 50
          },
          {
            "item": "Gel",
            "qty": 30
          }
        ]
      }
    ]
  },
  {
    "catId": "excavation-center",
    "name": "Excavation Center",
    "description": "",
    "levels": [
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 500
          },
          {
            "item": "Frames",
            "qty": 300
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 1000
          },
          {
            "item": "Frames",
            "qty": 600
          },
          {
            "item": "Glass",
            "qty": 800
          },
          {
            "item": "Wire",
            "qty": 4
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 1500
          },
          {
            "item": "Frames",
            "qty": 900
          },
          {
            "item": "Glass",
            "qty": 800
          },
          {
            "item": "Wire",
            "qty": 4
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 4000
          },
          {
            "item": "Frames",
            "qty": 2400
          },
          {
            "item": "Glass",
            "qty": 3200
          },
          {
            "item": "Plates",
            "qty": 8400
          },
          {
            "item": "Wire",
            "qty": 16
          },
          {
            "item": "Reinforced Concrete",
            "qty": 40
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 16000
          },
          {
            "item": "Frames",
            "qty": 9600
          },
          {
            "item": "Glass",
            "qty": 12800
          },
          {
            "item": "Plates",
            "qty": 25600
          },
          {
            "item": "Wire",
            "qty": 64
          },
          {
            "item": "Reinforced Concrete",
            "qty": 160
          }
        ]
      }
    ]
  },
  {
    "catId": "silicate-trading-hub",
    "name": "Silicate Trading Hub",
    "description": "",
    "levels": [
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 42000
          },
          {
            "item": "Concrete",
            "qty": 2400
          },
          {
            "item": "Glass",
            "qty": 960
          },
          {
            "item": "Bricks",
            "qty": 440
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 8
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 42000
          },
          {
            "item": "Concrete",
            "qty": 2400
          },
          {
            "item": "Glass",
            "qty": 960
          },
          {
            "item": "Bricks",
            "qty": 440
          },
          {
            "item": "Gel",
            "qty": 8
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 1680000
          },
          {
            "item": "Concrete",
            "qty": 96000
          },
          {
            "item": "Glass",
            "qty": 38400
          },
          {
            "item": "Bricks",
            "qty": 17600
          },
          {
            "item": "Gel",
            "qty": 160
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 84000000
          },
          {
            "item": "Concrete",
            "qty": 4800000
          },
          {
            "item": "Glass",
            "qty": 1920000
          },
          {
            "item": "Bricks",
            "qty": 880000
          },
          {
            "item": "Gel",
            "qty": 8000
          }
        ]
      }
    ]
  },
  {
    "catId": "improved-tokenium-scanner",
    "name": "Improved Tokenium Scanner",
    "description": "",
    "levels": [
      {
        "costs": [
          {
            "item": "Rods",
            "qty": 10000
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Rods",
            "qty": 30000
          },
          {
            "item": "Frames",
            "qty": 90
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Rods",
            "qty": 90000
          },
          {
            "item": "Frames",
            "qty": 270
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Rods",
            "qty": 270000
          },
          {
            "item": "Plates",
            "qty": 27000
          },
          {
            "item": "Frames",
            "qty": 810
          },
          {
            "item": "Batteries",
            "qty": 108
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Rods",
            "qty": 1620000
          },
          {
            "item": "Plates",
            "qty": 162000
          },
          {
            "item": "Frames",
            "qty": 4860
          },
          {
            "item": "Batteries",
            "qty": 648
          }
        ]
      }
    ]
  },
  {
    "catId": "improved-silicate-scanner-mk2",
    "name": "Improved Silicate Scanner Mk. 2",
    "description": "Lv 5 cost estimated",
    "levels": [
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 3
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 15
          },
          {
            "item": "Wire",
            "qty": 10
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 75
          },
          {
            "item": "Wire",
            "qty": 50
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 375
          },
          {
            "item": "Wire",
            "qty": 250
          },
          {
            "item": "Batteries",
            "qty": 125
          },
          {
            "item": "Reinforced Concrete",
            "qty": 125
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 1875
          },
          {
            "item": "Wire",
            "qty": 1250
          },
          {
            "item": "Batteries",
            "qty": 625
          },
          {
            "item": "Reinforced Concrete",
            "qty": 625
          }
        ]
      }
    ]
  },
  {
    "catId": "communication-center-mk2",
    "name": "Communication Center Mk. 2",
    "description": "",
    "levels": [
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 13500
          },
          {
            "item": "Bricks",
            "qty": 100
          },
          {
            "item": "Plates",
            "qty": 4800
          },
          {
            "item": "Rods",
            "qty": 2240
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 27000
          },
          {
            "item": "Bricks",
            "qty": 200
          },
          {
            "item": "Plates",
            "qty": 9600
          },
          {
            "item": "Rods",
            "qty": 4480
          },
          {
            "item": "Frames",
            "qty": 400
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 54000
          },
          {
            "item": "Bricks",
            "qty": 400
          },
          {
            "item": "Plates",
            "qty": 19200
          },
          {
            "item": "Rods",
            "qty": 8960
          },
          {
            "item": "Frames",
            "qty": 800
          },
          {
            "item": "Wire",
            "qty": 80
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 540000
          },
          {
            "item": "Bricks",
            "qty": 4000
          },
          {
            "item": "Plates",
            "qty": 192000
          },
          {
            "item": "Rods",
            "qty": 89600
          },
          {
            "item": "Frames",
            "qty": 8000
          },
          {
            "item": "Wire",
            "qty": 800
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 27000000
          },
          {
            "item": "Bricks",
            "qty": 200000
          },
          {
            "item": "Plates",
            "qty": 9600000
          },
          {
            "item": "Rods",
            "qty": 4480000
          },
          {
            "item": "Frames",
            "qty": 400000
          },
          {
            "item": "Wire",
            "qty": 40000
          }
        ]
      }
    ]
  },
  {
    "catId": "tokenium-enrichment-center",
    "name": "Tokenium Enrichment Center",
    "description": "",
    "levels": [
      {
        "costs": [
          {
            "item": "Frames",
            "qty": 600
          },
          {
            "item": "Glass",
            "qty": 600
          },
          {
            "item": "Bricks",
            "qty": 600
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Frames",
            "qty": 1200
          },
          {
            "item": "Glass",
            "qty": 1200
          },
          {
            "item": "Bricks",
            "qty": 1200
          },
          {
            "item": "Gel",
            "qty": 200
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Frames",
            "qty": 2400
          },
          {
            "item": "Glass",
            "qty": 2400
          },
          {
            "item": "Bricks",
            "qty": 2400
          },
          {
            "item": "Gel",
            "qty": 400
          },
          {
            "item": "Wire",
            "qty": 200
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Frames",
            "qty": 4800
          },
          {
            "item": "Glass",
            "qty": 4800
          },
          {
            "item": "Bricks",
            "qty": 4800
          },
          {
            "item": "Gel",
            "qty": 800
          },
          {
            "item": "Wire",
            "qty": 400
          },
          {
            "item": "Batteries",
            "qty": 480
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Frames",
            "qty": 57600
          },
          {
            "item": "Glass",
            "qty": 57600
          },
          {
            "item": "Bricks",
            "qty": 57600
          },
          {
            "item": "Gel",
            "qty": 9600
          },
          {
            "item": "Wire",
            "qty": 4800
          },
          {
            "item": "Batteries",
            "qty": 5760
          }
        ]
      }
    ]
  },
  {
    "catId": "rig-parts-production-facility",
    "name": "Rig Parts Production Facility",
    "description": "Lv 29–48 costs estimated",
    "levels": [
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 100
          },
          {
            "item": "Frames",
            "qty": 16
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 130
          },
          {
            "item": "Frames",
            "qty": 21
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 169
          },
          {
            "item": "Frames",
            "qty": 28
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 220
          },
          {
            "item": "Frames",
            "qty": 36
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 286
          },
          {
            "item": "Frames",
            "qty": 46
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 372
          },
          {
            "item": "Frames",
            "qty": 60
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 483
          },
          {
            "item": "Frames",
            "qty": 78
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 628
          },
          {
            "item": "Frames",
            "qty": 101
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 816
          },
          {
            "item": "Frames",
            "qty": 131
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 1061
          },
          {
            "item": "Frames",
            "qty": 170
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 1379
          },
          {
            "item": "Frames",
            "qty": 221
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 1972
          },
          {
            "item": "Frames",
            "qty": 316
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 2820
          },
          {
            "item": "Frames",
            "qty": 452
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 4032
          },
          {
            "item": "Frames",
            "qty": 646
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 5765
          },
          {
            "item": "Frames",
            "qty": 923
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 8244
          },
          {
            "item": "Frames",
            "qty": 1319
          },
          {
            "item": "Plates",
            "qty": 7420
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 11790
          },
          {
            "item": "Frames",
            "qty": 1887
          },
          {
            "item": "Plates",
            "qty": 10610
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 16860
          },
          {
            "item": "Frames",
            "qty": 2698
          },
          {
            "item": "Plates",
            "qty": 15170
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 24110
          },
          {
            "item": "Frames",
            "qty": 3857
          },
          {
            "item": "Plates",
            "qty": 21700
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 34470
          },
          {
            "item": "Frames",
            "qty": 5516
          },
          {
            "item": "Plates",
            "qty": 31030
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 49290
          },
          {
            "item": "Frames",
            "qty": 7888
          },
          {
            "item": "Plates",
            "qty": 44370
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 77540
          },
          {
            "item": "Frames",
            "qty": 12410
          },
          {
            "item": "Plates",
            "qty": 69790
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 121970
          },
          {
            "item": "Frames",
            "qty": 19520
          },
          {
            "item": "Plates",
            "qty": 109770
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 191860
          },
          {
            "item": "Frames",
            "qty": 30700
          },
          {
            "item": "Plates",
            "qty": 172670
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 301790
          },
          {
            "item": "Frames",
            "qty": 48290
          },
          {
            "item": "Plates",
            "qty": 271610
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 474720
          },
          {
            "item": "Frames",
            "qty": 75960
          },
          {
            "item": "Plates",
            "qty": 427250
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 746730
          },
          {
            "item": "Frames",
            "qty": 119490
          },
          {
            "item": "Plates",
            "qty": 672060
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 1174610
          },
          {
            "item": "Frames",
            "qty": 187960
          },
          {
            "item": "Plates",
            "qty": 1057150
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 1847660
          },
          {
            "item": "Frames",
            "qty": 295660
          },
          {
            "item": "Plates",
            "qty": 1662900
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 2906370
          },
          {
            "item": "Frames",
            "qty": 465070
          },
          {
            "item": "Plates",
            "qty": 2615740
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 4571720
          },
          {
            "item": "Frames",
            "qty": 731560
          },
          {
            "item": "Plates",
            "qty": 4114560
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 7191320
          },
          {
            "item": "Frames",
            "qty": 1150740
          },
          {
            "item": "Plates",
            "qty": 6472200
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 11311950
          },
          {
            "item": "Frames",
            "qty": 1810110
          },
          {
            "item": "Plates",
            "qty": 10180770
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 17793700
          },
          {
            "item": "Frames",
            "qty": 2847300
          },
          {
            "item": "Plates",
            "qty": 16014350
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 27989490
          },
          {
            "item": "Frames",
            "qty": 4478800
          },
          {
            "item": "Plates",
            "qty": 25190570
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 44027470
          },
          {
            "item": "Frames",
            "qty": 7045150
          },
          {
            "item": "Plates",
            "qty": 39624770
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 69255210
          },
          {
            "item": "Frames",
            "qty": 11082020
          },
          {
            "item": "Plates",
            "qty": 62329760
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 108938450
          },
          {
            "item": "Frames",
            "qty": 17432020
          },
          {
            "item": "Plates",
            "qty": 98044710
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 171360180
          },
          {
            "item": "Frames",
            "qty": 27420570
          },
          {
            "item": "Plates",
            "qty": 154224330
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 269549560
          },
          {
            "item": "Frames",
            "qty": 43132560
          },
          {
            "item": "Plates",
            "qty": 242594870
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 424001460
          },
          {
            "item": "Frames",
            "qty": 67847520
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 666954300
          },
          {
            "item": "Frames",
            "qty": 106724150
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 1049119110
          },
          {
            "item": "Frames",
            "qty": 167877090
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 1650264360
          },
          {
            "item": "Frames",
            "qty": 264070660
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 2595865840
          },
          {
            "item": "Frames",
            "qty": 415383150
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 4083296970
          },
          {
            "item": "Frames",
            "qty": 653397690
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 6423026130
          },
          {
            "item": "Frames",
            "qty": 1027794570
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Gel",
            "qty": 10103420100
          },
          {
            "item": "Frames",
            "qty": 1616720860
          }
        ]
      }
    ]
  },
  {
    "catId": "all-round-giga-scanner",
    "name": "All Round Giga-Scanner",
    "description": "Lv 31–48 costs estimated",
    "levels": [
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 10
          },
          {
            "item": "Gel",
            "qty": 4
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 13
          },
          {
            "item": "Gel",
            "qty": 6
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 17
          },
          {
            "item": "Gel",
            "qty": 7
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 22
          },
          {
            "item": "Gel",
            "qty": 9
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 29
          },
          {
            "item": "Gel",
            "qty": 12
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 38
          },
          {
            "item": "Gel",
            "qty": 15
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 49
          },
          {
            "item": "Gel",
            "qty": 20
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 63
          },
          {
            "item": "Gel",
            "qty": 26
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 82
          },
          {
            "item": "Gel",
            "qty": 33
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 107
          },
          {
            "item": "Gel",
            "qty": 43
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 138
          },
          {
            "item": "Gel",
            "qty": 56
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 198
          },
          {
            "item": "Gel",
            "qty": 79
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 282
          },
          {
            "item": "Gel",
            "qty": 113
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 404
          },
          {
            "item": "Gel",
            "qty": 162
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 577
          },
          {
            "item": "Gel",
            "qty": 231
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 825
          },
          {
            "item": "Gel",
            "qty": 330
          },
          {
            "item": "Bits",
            "qty": 16490
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 1179
          },
          {
            "item": "Gel",
            "qty": 472
          },
          {
            "item": "Bits",
            "qty": 23580
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 1686
          },
          {
            "item": "Gel",
            "qty": 675
          },
          {
            "item": "Bits",
            "qty": 33720
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 2411
          },
          {
            "item": "Gel",
            "qty": 965
          },
          {
            "item": "Bits",
            "qty": 48210
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 3448
          },
          {
            "item": "Gel",
            "qty": 1379
          },
          {
            "item": "Bits",
            "qty": 68940
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 4930
          },
          {
            "item": "Gel",
            "qty": 1972
          },
          {
            "item": "Bits",
            "qty": 98590
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 7754
          },
          {
            "item": "Gel",
            "qty": 3102
          },
          {
            "item": "Bits",
            "qty": 155080
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 12200
          },
          {
            "item": "Gel",
            "qty": 4879
          },
          {
            "item": "Bits",
            "qty": 243940
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 19190
          },
          {
            "item": "Gel",
            "qty": 7675
          },
          {
            "item": "Bits",
            "qty": 383720
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 30180
          },
          {
            "item": "Gel",
            "qty": 12070
          },
          {
            "item": "Bits",
            "qty": 603590
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 47470
          },
          {
            "item": "Gel",
            "qty": 18990
          },
          {
            "item": "Bits",
            "qty": 949440
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 74670
          },
          {
            "item": "Gel",
            "qty": 29870
          },
          {
            "item": "Bits",
            "qty": 1493470
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 117460
          },
          {
            "item": "Gel",
            "qty": 46990
          },
          {
            "item": "Bits",
            "qty": 2349230
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 184760
          },
          {
            "item": "Gel",
            "qty": 73920
          },
          {
            "item": "Bits",
            "qty": 3695340
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 290640
          },
          {
            "item": "Gel",
            "qty": 116256
          },
          {
            "item": "Bits",
            "qty": 5812800
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 457177
          },
          {
            "item": "Gel",
            "qty": 182871
          },
          {
            "item": "Bits",
            "qty": 9143534
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 719139
          },
          {
            "item": "Gel",
            "qty": 287656
          },
          {
            "item": "Bits",
            "qty": 14382780
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 1131206
          },
          {
            "item": "Gel",
            "qty": 452482
          },
          {
            "item": "Bits",
            "qty": 22624112
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 1779386
          },
          {
            "item": "Gel",
            "qty": 711755
          },
          {
            "item": "Bits",
            "qty": 35587729
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 2798975
          },
          {
            "item": "Gel",
            "qty": 1119590
          },
          {
            "item": "Bits",
            "qty": 55979497
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 4402787
          },
          {
            "item": "Gel",
            "qty": 1761115
          },
          {
            "item": "Bits",
            "qty": 88055749
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 6925585
          },
          {
            "item": "Gel",
            "qty": 2770234
          },
          {
            "item": "Bits",
            "qty": 138511693
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 10893945
          },
          {
            "item": "Gel",
            "qty": 4357578
          },
          {
            "item": "Bits",
            "qty": 217878894
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 17136175
          },
          {
            "item": "Gel",
            "qty": 6854470
          },
          {
            "item": "Bits",
            "qty": 342723500
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 26955203
          },
          {
            "item": "Gel",
            "qty": 10782081
          },
          {
            "item": "Bits",
            "qty": 539104065
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 42400535
          },
          {
            "item": "Gel",
            "qty": 16960214
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 66696041
          },
          {
            "item": "Gel",
            "qty": 26678416
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 104912873
          },
          {
            "item": "Gel",
            "qty": 41965149
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 165027949
          },
          {
            "item": "Gel",
            "qty": 66011180
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 259588963
          },
          {
            "item": "Gel",
            "qty": 103835585
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 408333439
          },
          {
            "item": "Gel",
            "qty": 163333376
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 642308500
          },
          {
            "item": "Gel",
            "qty": 256923400
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Wire",
            "qty": 1010351271
          },
          {
            "item": "Gel",
            "qty": 404140508
          }
        ]
      }
    ]
  },
  {
    "catId": "battery-factory",
    "name": "Battery Factory",
    "description": "Unlocks Batteries",
    "levels": [
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 60000000
          },
          {
            "item": "Glass",
            "qty": 150000
          },
          {
            "item": "Frames",
            "qty": 150000
          },
          {
            "item": "Gel",
            "qty": 150000
          },
          {
            "item": "Reinforced Concrete",
            "qty": 1
          }
        ]
      }
    ]
  },
  {
    "catId": "the-concrete-corner",
    "name": "The Concrete Corner",
    "description": "Unlocks Reinforced Concrete",
    "levels": [
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 40000000
          },
          {
            "item": "Glass",
            "qty": 100000
          },
          {
            "item": "Bricks",
            "qty": 100000
          },
          {
            "item": "Gel",
            "qty": 100000
          }
        ]
      }
    ]
  },
  {
    "catId": "the-tower-of-chad",
    "name": "The Tower of Chad",
    "description": "",
    "levels": [
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 50000000
          },
          {
            "item": "Concrete",
            "qty": 50000000
          },
          {
            "item": "Bricks",
            "qty": 1000000
          },
          {
            "item": "Reinforced Concrete",
            "qty": 200
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 75000000
          },
          {
            "item": "Concrete",
            "qty": 75000000
          },
          {
            "item": "Bricks",
            "qty": 1500000
          },
          {
            "item": "Reinforced Concrete",
            "qty": 390
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 112500000
          },
          {
            "item": "Concrete",
            "qty": 112500000
          },
          {
            "item": "Bricks",
            "qty": 2250000
          },
          {
            "item": "Reinforced Concrete",
            "qty": 780
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 168750000
          },
          {
            "item": "Concrete",
            "qty": 168750000
          },
          {
            "item": "Bricks",
            "qty": 3375000
          },
          {
            "item": "Reinforced Concrete",
            "qty": 1463
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 253125000
          },
          {
            "item": "Concrete",
            "qty": 253125000
          },
          {
            "item": "Bricks",
            "qty": 5062500
          },
          {
            "item": "Reinforced Concrete",
            "qty": 2588
          }
        ]
      }
    ]
  },
  {
    "catId": "biochemical-laboratory",
    "name": "Biochemical Laboratory",
    "description": "Lv 5 cost estimated",
    "levels": [
      {
        "costs": [
          {
            "item": "Reinforced Concrete",
            "qty": 400
          },
          {
            "item": "Batteries",
            "qty": 100
          },
          {
            "item": "Wire",
            "qty": 400000
          },
          {
            "item": "Frames",
            "qty": 100000
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Reinforced Concrete",
            "qty": 750
          },
          {
            "item": "Batteries",
            "qty": 300
          },
          {
            "item": "Wire",
            "qty": 600150
          },
          {
            "item": "Frames",
            "qty": 150150
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Reinforced Concrete",
            "qty": 1390
          },
          {
            "item": "Batteries",
            "qty": 715
          },
          {
            "item": "Wire",
            "qty": 900490
          },
          {
            "item": "Frames",
            "qty": 225490
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Reinforced Concrete",
            "qty": 2483
          },
          {
            "item": "Batteries",
            "qty": 1470
          },
          {
            "item": "Wire",
            "qty": 1351133
          },
          {
            "item": "Frames",
            "qty": 338633
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Reinforced Concrete",
            "qty": 4290
          },
          {
            "item": "Batteries",
            "qty": 2772
          },
          {
            "item": "Wire",
            "qty": 2027000
          },
          {
            "item": "Frames",
            "qty": 508520
          }
        ]
      }
    ]
  }
];
