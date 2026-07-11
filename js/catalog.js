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
      }
    ]
  },
  {
    "catId": "improved-silicate-scanner-mk2",
    "name": "Improved Silicate Scanner Mk. 2",
    "description": "",
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
            "qty": 18
          },
          {
            "item": "Wire",
            "qty": 10
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
      }
    ]
  },
  {
    "catId": "rig-parts-production-facility",
    "name": "Rig Parts Production Facility",
    "description": "",
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
      }
    ]
  },
  {
    "catId": "all-round-giga-scanner",
    "name": "All Round Giga-Scanner",
    "description": "",
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
      }
    ]
  }
];
