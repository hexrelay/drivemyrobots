module Main exposing (main)

import Browser
import Element exposing (..)
import Element.Background as Background
import Element.Border as Border
import Element.Font as Font
import Element.Region as Region
import Html exposing (Html)


main : Program () () ()
main =
    Browser.sandbox
        { init = ()
        , update = \_ _ -> ()
        , view = view
        }


view : () -> Html ()
view _ =
    layout
        [ Background.color (rgb255 15 23 42)
        , Font.color (rgb255 226 232 240)
        , Font.family [ Font.typeface "system-ui", Font.sansSerif ]
        , padding 40
        ]
        content


content : Element ()
content =
    column
        [ centerX
        , width (fill |> maximum 800)
        , spacing 40
        ]
        [ header
        , heroSection
        , statusSection
        , architectureSection
        , linksSection
        , footer
        ]


header : Element ()
header =
    column [ spacing 8 ]
        [ el
            [ Region.heading 1
            , Font.size 48
            , Font.bold
            , Font.color (rgb255 96 165 250)
            ]
            (text "Drive My Robots")
        , el
            [ Font.size 20
            , Font.color (rgb255 148 163 184)
            ]
            (text "Remote teleoperation via browser")
        ]


heroSection : Element ()
heroSection =
    paragraph
        [ Font.size 18
        , Font.color (rgb255 203 213 225)
        , spacing 8
        ]
        [ text "This is an in-development project working toward the following dream: "
        , text "a room full of robots, which Internet denizens can remotely log in to and drive around, each with their own camera. "
        , text "It'll be like a videogame in interface, but the game takes place in real life, in some garage somewhere. "
        , text "You, dear user, get a weird new game to play; and I get a bizarre set of new pets that will likely try to break out of any container I put them in."
        ]


statusSection : Element ()
statusSection =
    column
        [ spacing 16
        , width fill
        , padding 24
        , Background.color (rgb255 30 41 59)
        , Border.rounded 8
        ]
        [ el
            [ Region.heading 2
            , Font.size 24
            , Font.bold
            ]
            (text "Current Status")
        , paragraph [ Font.color (rgb255 203 213 225) ]
            [ text "The project is in active development. A working prototype validates "
            , text "the full pipeline using synthetic video (a bouncing basketball you can control). "
            , text "Hardware is on order for the first camera-equipped test."
            ]
        , column [ spacing 8, paddingXY 16 0 ]
            [ statusItem True "WebRTC video streaming via MediaMTX"
            , statusItem True "Elm browser frontend with keyboard controls"
            , statusItem True "Persistent TCP connections for low-latency input"
            , statusItem True "~200-300ms end-to-end latency achieved"
            , statusItem False "Real camera integration (hardware pending)"
            , statusItem False "Motor control on physical robot"
            ]
        ]


statusItem : Bool -> String -> Element ()
statusItem done label =
    row [ spacing 12 ]
        [ el
            [ Font.color
                (if done then
                    rgb255 74 222 128
                 else
                    rgb255 251 191 36
                )
            ]
            (text
                (if done then
                    "✓"
                 else
                    "○"
                )
            )
        , el [ Font.color (rgb255 203 213 225) ] (text label)
        ]


architectureSection : Element ()
architectureSection =
    column
        [ spacing 16
        , width fill
        ]
        [ el
            [ Region.heading 2
            , Font.size 24
            , Font.bold
            ]
            (text "Architecture")
        , column
            [ spacing 12
            , Font.size 16
            , Font.color (rgb255 203 213 225)
            ]
            [ architectureRow "Robot (Pi)" "Captures video, encodes H.264, streams via RTSP"
            , architectureRow "Relay Server" "MediaMTX converts RTSP → WebRTC for browsers"
            , architectureRow "Browser" "Elm app displays video, sends keyboard commands"
            , architectureRow "Input Path" "HTTP → Relay → persistent TCP → Robot"
            ]
        ]


architectureRow : String -> String -> Element ()
architectureRow component description =
    row [ spacing 16, width fill ]
        [ el
            [ width (px 120)
            , Font.bold
            , Font.color (rgb255 96 165 250)
            ]
            (text component)
        , paragraph [ width fill ] [ text description ]
        ]


linksSection : Element ()
linksSection =
    column
        [ spacing 16
        , width fill
        ]
        [ el
            [ Region.heading 2
            , Font.size 24
            , Font.bold
            ]
            (text "Links")
        , row [ spacing 24 ]
            [ linkButton "GitHub" "https://github.com/hexrelay/drivemyrobots"
            , linkButton "Test Page" "/test"
            ]
        ]


linkButton : String -> String -> Element ()
linkButton label url =
    link
        [ padding 12
        , Background.color (rgb255 37 99 235)
        , Border.rounded 6
        , Font.size 16
        , mouseOver [ Background.color (rgb255 59 130 246) ]
        ]
        { url = url
        , label = text label
        }


footer : Element ()
footer =
    el
        [ paddingXY 0 24
        , Font.size 14
        , Font.color (rgb255 100 116 139)
        , centerX
        ]
        (text "A project by Logan Brutsche and his robotic pal HexRelay")
