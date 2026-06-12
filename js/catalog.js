"use strict";
/* ============================================================================
 * PROJECT_CATALOG — static, read-only catalog of in-game projects.
 *
 * Each entry is universal game data: { catId, name, description, levels }.
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
 * ========================================================================== */
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
            "qty": 5700
          },
          {
            "item": "Glass",
            "qty": 665
          },
          {
            "item": "Plates",
            "qty": 2850
          },
          {
            "item": "Frames",
            "qty": 38
          },
          {
            "item": "Bricks",
            "qty": 90
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
            "qty": 6413
          },
          {
            "item": "Concrete",
            "qty": 8550
          },
          {
            "item": "Glass",
            "qty": 357
          },
          {
            "item": "Frames",
            "qty": 357
          }
        ]
      }
    ]
  },
  {
    "catId": "gym-and-relaxation-center-mk2",
    "name": "Gym and Relaxation Center Mk. 2",
    "description": "Stamina Recharge Rate & EXP",
    "levels": [
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 300
          },
          {
            "item": "Plates",
            "qty": 100
          },
          {
            "item": "Rods",
            "qty": 250
          },
          {
            "item": "Frames",
            "qty": 250
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
            "qty": 450
          },
          {
            "item": "Plates",
            "qty": 150
          },
          {
            "item": "Rods",
            "qty": 375
          },
          {
            "item": "Frames",
            "qty": 375
          },
          {
            "item": "Concrete",
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
            "item": "Plates",
            "qty": 225
          },
          {
            "item": "Rods",
            "qty": 563
          },
          {
            "item": "Frames",
            "qty": 563
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
            "qty": 1425
          },
          {
            "item": "Plates",
            "qty": 475
          },
          {
            "item": "Rods",
            "qty": 1188
          },
          {
            "item": "Frames",
            "qty": 1188
          },
          {
            "item": "Concrete",
            "qty": 1125
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
            "qty": 33600
          },
          {
            "item": "Concrete",
            "qty": 33600
          },
          {
            "item": "Glass",
            "qty": 2520
          },
          {
            "item": "Bricks",
            "qty": 2940
          },
          {
            "item": "Plates",
            "qty": 1680
          },
          {
            "item": "Rods",
            "qty": 4550
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
            "item": "Plates",
            "qty": 850
          },
          {
            "item": "Glass",
            "qty": 160
          },
          {
            "item": "Concrete",
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
            "qty": 380
          },
          {
            "item": "Plates",
            "qty": 300
          },
          {
            "item": "Frames",
            "qty": 23
          }
        ]
      }
    ]
  },
  {
    "catId": "finance-center",
    "name": "Finance Center",
    "description": "",
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
            "qty": 288
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
            "qty": 1857
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
      }
    ]
  },
  {
    "catId": "jade-refinery",
    "name": "Jade Refinery",
    "description": "",
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
      }
    ]
  },
  {
    "catId": "hospital-wing",
    "name": "Hospital Wing",
    "description": "",
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
      }
    ]
  },
  {
    "catId": "off-rock-mining-operation",
    "name": "Off-Rock Mining Operation",
    "description": "",
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
      }
    ]
  },
  {
    "catId": "tokenium-mining-center",
    "name": "Tokenium Mining Center",
    "description": "",
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
      }
    ]
  },
  {
    "catId": "vespium-drill-hub",
    "name": "Vespium Drill Hub",
    "description": "",
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
      }
    ]
  }
];
