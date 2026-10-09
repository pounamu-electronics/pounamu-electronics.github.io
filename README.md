# Volume Knob Kit Configurator

This repo contains the Volume Knob Kit Configurator webapp source.

All source files sit inside `src/` directory. This repo uses Bun to compile all source into single output file (index.html) at the root of the directory

## Revision History

### v2.1.0

- Integrated Bun to compile all HTML, CSS and JS into single HTML executable. This allows people to save the raw HTML
  and execute without any internet making this a portable tool.

### v2.0.0

- Support added for custom mapping input to output

### v1.0.0

- Initial release

## Default Output Mapping

|                    INPUT                     |        OUTPUT        |
| :------------------------------------------: | :------------------: |
|     Volume Knob Clockwise Rotation (CW)      |       Volume+        |
| Volume Knob Counter Clockwise Rotation (CCW) |       Volume-        |
|              Button Short Press              |       Mute/ATT       |
|              Button Long Press               |      Next Track      |
|   Button Double Press (Generic Resistive)    | Enable Learning Mode |
|         Button Double Press (Others)         |    Previous Track    |

## Output Function Support

_FW v4.0.0_

|     OUTPUT     |        JVC         |      KENWOOD       |       ALPINE       |      PIONEER       |      USB HID       |        SONY        |
| :------------: | :----------------: | :----------------: | :----------------: | :----------------: | :----------------: | :----------------: |
|    Volume+     | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: |
|    Volume-     | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: |
|    Mute/ATT    | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: |
|   Next Track   | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: |
| Previous Track | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: | :heavy_check_mark: |
|   Play/Pause   |        :x:         | :heavy_check_mark: |        :x:         |        :x:         | :heavy_check_mark: |        :x:         |
| Change Source  |        :x:         |        :x:         |        :x:         | :heavy_check_mark: |        :x:         |        :x:         |

## Single File Output Compliling

Use Bun to compile the raw source files into single file output

```
bun build --compile --target=browser ./src/reswc_updater.html --outfile index.html
```

## Found a bug or issue?

If you have found an issue, please raise a [GitHub Issue](https://github.com/pounamu-electronics/pounamu-electronics.github.io/issues)!
