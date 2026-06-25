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
            "qty": 13332
          },
          {
            "item": "Plates",
            "qty": 17775
          },
          {
            "item": "Bricks",
            "qty": 2669
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 24958
          },
          {
            "item": "Plates",
            "qty": 33275
          },
          {
            "item": "Bricks",
            "qty": 4996
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 46721
          },
          {
            "item": "Plates",
            "qty": 62291
          },
          {
            "item": "Bricks",
            "qty": 9353
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 87462
          },
          {
            "item": "Plates",
            "qty": 116609
          },
          {
            "item": "Bricks",
            "qty": 17509
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Glass",
            "qty": 163729
          },
          {
            "item": "Plates",
            "qty": 218292
          },
          {
            "item": "Bricks",
            "qty": 32777
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
            "qty": 26663
          },
          {
            "item": "Rods",
            "qty": 17775
          },
          {
            "item": "Plates",
            "qty": 8888
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 49913
          },
          {
            "item": "Rods",
            "qty": 33275
          },
          {
            "item": "Plates",
            "qty": 16638
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 93437
          },
          {
            "item": "Rods",
            "qty": 62291
          },
          {
            "item": "Plates",
            "qty": 31146
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 174914
          },
          {
            "item": "Rods",
            "qty": 116609
          },
          {
            "item": "Plates",
            "qty": 58305
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 327439
          },
          {
            "item": "Rods",
            "qty": 218292
          },
          {
            "item": "Plates",
            "qty": 109147
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
            "qty": 26663
          },
          {
            "item": "Glass",
            "qty": 2224
          },
          {
            "item": "Bricks",
            "qty": 889
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 49913
          },
          {
            "item": "Glass",
            "qty": 4163
          },
          {
            "item": "Bricks",
            "qty": 1664
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 93437
          },
          {
            "item": "Glass",
            "qty": 7793
          },
          {
            "item": "Bricks",
            "qty": 3115
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 174914
          },
          {
            "item": "Glass",
            "qty": 14588
          },
          {
            "item": "Bricks",
            "qty": 5831
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Concrete",
            "qty": 327439
          },
          {
            "item": "Glass",
            "qty": 27309
          },
          {
            "item": "Bricks",
            "qty": 10916
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
            "qty": 26663
          },
          {
            "item": "Rods",
            "qty": 17775
          },
          {
            "item": "Concrete",
            "qty": 22221
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 49913
          },
          {
            "item": "Rods",
            "qty": 33275
          },
          {
            "item": "Concrete",
            "qty": 41598
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 93437
          },
          {
            "item": "Rods",
            "qty": 62291
          },
          {
            "item": "Concrete",
            "qty": 77871
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 174914
          },
          {
            "item": "Rods",
            "qty": 116609
          },
          {
            "item": "Concrete",
            "qty": 145775
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 327439
          },
          {
            "item": "Rods",
            "qty": 218292
          },
          {
            "item": "Concrete",
            "qty": 272891
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
            "qty": 26663
          },
          {
            "item": "Bricks",
            "qty": 8888
          },
          {
            "item": "Glass",
            "qty": 2224
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 49913
          },
          {
            "item": "Bricks",
            "qty": 16638
          },
          {
            "item": "Glass",
            "qty": 4163
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 93437
          },
          {
            "item": "Bricks",
            "qty": 31146
          },
          {
            "item": "Glass",
            "qty": 7793
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 174914
          },
          {
            "item": "Bricks",
            "qty": 58305
          },
          {
            "item": "Glass",
            "qty": 14588
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bits",
            "qty": 327439
          },
          {
            "item": "Bricks",
            "qty": 109147
          },
          {
            "item": "Glass",
            "qty": 27309
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
            "qty": 6666
          },
          {
            "item": "Plates",
            "qty": 17775
          },
          {
            "item": "Bits",
            "qty": 22221
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 12479
          },
          {
            "item": "Plates",
            "qty": 33275
          },
          {
            "item": "Bits",
            "qty": 41598
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 23361
          },
          {
            "item": "Plates",
            "qty": 62291
          },
          {
            "item": "Bits",
            "qty": 77871
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 43732
          },
          {
            "item": "Plates",
            "qty": 116609
          },
          {
            "item": "Bits",
            "qty": 145775
          }
        ]
      },
      {
        "costs": [
          {
            "item": "Bricks",
            "qty": 81866
          },
          {
            "item": "Plates",
            "qty": 218292
          },
          {
            "item": "Bits",
            "qty": 272891
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
            "qty": 40000
          },
          {
            "item": "Frames",
            "qty": 90
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
  }
];
