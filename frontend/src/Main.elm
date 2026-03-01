port module Main exposing (main)

import Browser
import Browser.Events
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Json.Decode as Decode
import Json.Encode as Encode


main : Program Flags Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , subscriptions = subscriptions
        , view = view
        }



-- PORTS


port connectToStream : String -> Cmd msg


port sendCommand : Encode.Value -> Cmd msg


port streamStatus : (String -> msg) -> Sub msg


port commandAck : (String -> msg) -> Sub msg



-- MODEL


type alias Flags =
    { streamUrl : String
    }


type ConnectionStatus
    = Disconnected
    | Connecting
    | Connected
    | Error String


type alias Model =
    { streamUrl : String
    , connectionStatus : ConnectionStatus
    , lastCommand : Maybe String
    , colorIndex : Int
    }


colors : List String
colors =
    [ "#ff0000" -- red
    , "#00ff00" -- green
    , "#0000ff" -- blue
    , "#ffff00" -- yellow
    , "#ff00ff" -- magenta
    , "#00ffff" -- cyan
    , "#ffffff" -- white
    , "#000000" -- black
    ]


init : Flags -> ( Model, Cmd Msg )
init flags =
    ( { streamUrl = flags.streamUrl
      , connectionStatus = Disconnected
      , lastCommand = Nothing
      , colorIndex = 0
      }
    , Cmd.none
    )



-- UPDATE


type Msg
    = Connect
    | Disconnect
    | StreamStatusChanged String
    | SendColor Int
    | CommandAcknowledged String
    | KeyPressed String


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        Connect ->
            ( { model | connectionStatus = Connecting }
            , connectToStream model.streamUrl
            )

        Disconnect ->
            ( { model | connectionStatus = Disconnected }
            , Cmd.none
            )

        StreamStatusChanged status ->
            let
                newStatus =
                    case status of
                        "connected" ->
                            Connected

                        "connecting" ->
                            Connecting

                        "disconnected" ->
                            Disconnected

                        _ ->
                            Error status
            in
            ( { model | connectionStatus = newStatus }
            , Cmd.none
            )

        SendColor index ->
            let
                colorValue =
                    List.drop index colors
                        |> List.head
                        |> Maybe.withDefault "#ffffff"

                command =
                    Encode.object
                        [ ( "type", Encode.string "setColor" )
                        , ( "color", Encode.string colorValue )
                        , ( "index", Encode.int index )
                        ]
            in
            ( { model
                | lastCommand = Just ("Color: " ++ colorValue)
                , colorIndex = index
              }
            , sendCommand command
            )

        CommandAcknowledged ack ->
            ( { model | lastCommand = Just ("Ack: " ++ ack) }
            , Cmd.none
            )

        KeyPressed key ->
            case key of
                "1" ->
                    update (SendColor 0) model

                "2" ->
                    update (SendColor 1) model

                "3" ->
                    update (SendColor 2) model

                "4" ->
                    update (SendColor 3) model

                "5" ->
                    update (SendColor 4) model

                "6" ->
                    update (SendColor 5) model

                "7" ->
                    update (SendColor 6) model

                "8" ->
                    update (SendColor 7) model

                "ArrowUp" ->
                    ( { model | lastCommand = Just "Direction: up" }
                    , sendCommand (encodeDirection "up")
                    )

                "ArrowDown" ->
                    ( { model | lastCommand = Just "Direction: down" }
                    , sendCommand (encodeDirection "down")
                    )

                "ArrowLeft" ->
                    ( { model | lastCommand = Just "Direction: left" }
                    , sendCommand (encodeDirection "left")
                    )

                "ArrowRight" ->
                    ( { model | lastCommand = Just "Direction: right" }
                    , sendCommand (encodeDirection "right")
                    )

                _ ->
                    ( model, Cmd.none )


encodeDirection : String -> Encode.Value
encodeDirection dir =
    Encode.object
        [ ( "type", Encode.string "setDirection" )
        , ( "direction", Encode.string dir )
        ]



-- SUBSCRIPTIONS


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.batch
        [ streamStatus StreamStatusChanged
        , commandAck CommandAcknowledged
        , Browser.Events.onKeyDown (Decode.map KeyPressed keyDecoder)
        ]


keyDecoder : Decode.Decoder String
keyDecoder =
    Decode.field "key" Decode.string



-- VIEW


view : Model -> Html Msg
view model =
    div [ class "container" ]
        [ viewHeader model
        , viewVideo model
        , viewControls model
        , viewStatus model
        ]


viewHeader : Model -> Html Msg
viewHeader _ =
    div [ class "header" ]
        [ h1 [] [ text "Drive My Robots" ]
        , p [ class "subtitle" ] [ text "LED Feedback Prototype" ]
        ]


viewVideo : Model -> Html Msg
viewVideo model =
    div [ class "video-container" ]
        [ video
            [ id "video"
            , attribute "autoplay" ""
            , attribute "playsinline" ""
            , attribute "muted" ""
            ]
            []
        , case model.connectionStatus of
            Disconnected ->
                div [ class "video-overlay" ]
                    [ button [ onClick Connect, class "connect-btn" ]
                        [ text "Connect" ]
                    ]

            Connecting ->
                div [ class "video-overlay" ]
                    [ div [ class "spinner" ] []
                    , p [] [ text "Connecting..." ]
                    ]

            Error err ->
                div [ class "video-overlay error" ]
                    [ p [] [ text ("Error: " ++ err) ]
                    , button [ onClick Connect, class "connect-btn" ]
                        [ text "Retry" ]
                    ]

            Connected ->
                text ""
        ]


viewControls : Model -> Html Msg
viewControls model =
    div [ class "controls" ]
        [ p [ class "instructions" ] [ text "Arrow keys to move, 1-8 to change color:" ]
        , div [ class "color-buttons" ]
            (List.indexedMap (viewColorButton model.colorIndex) colors)
        ]


viewColorButton : Int -> Int -> String -> Html Msg
viewColorButton selectedIndex index color =
    button
        [ class "color-btn"
        , classList [ ( "selected", selectedIndex == index ) ]
        , style "background-color" color
        , onClick (SendColor index)
        ]
        [ text (String.fromInt (index + 1)) ]


viewStatus : Model -> Html Msg
viewStatus model =
    div [ class "status" ]
        [ p []
            [ text "Status: "
            , span [ class (statusClass model.connectionStatus) ]
                [ text (statusText model.connectionStatus) ]
            ]
        , case model.lastCommand of
            Just cmd ->
                p [] [ text ("Last: " ++ cmd) ]

            Nothing ->
                text ""
        ]


statusClass : ConnectionStatus -> String
statusClass status =
    case status of
        Connected ->
            "status-connected"

        Connecting ->
            "status-connecting"

        Disconnected ->
            "status-disconnected"

        Error _ ->
            "status-error"


statusText : ConnectionStatus -> String
statusText status =
    case status of
        Connected ->
            "Connected"

        Connecting ->
            "Connecting..."

        Disconnected ->
            "Disconnected"

        Error err ->
            "Error: " ++ err
