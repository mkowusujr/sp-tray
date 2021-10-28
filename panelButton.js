// Copyright(C) 2021  Emre Şenliyim

// This program is free software: you can redistribute it and / or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
//     (at your option) any later version.

// This program is distributed in the hope that it will be useful,
//     but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.See the
// GNU General Public License for more details.

//     You should have received a copy of the GNU General Public License
// along with this program.If not, see < http://www.gnu.org/licenses/>.

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Main = imports.ui.main;
const { St, Clutter, GObject, GLib, Gio } = imports.gi;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const ExtensionUtils = imports.misc.extensionUtils;

//dbus constants
const dest = "org.mpris.MediaPlayer2.spotify";
const path = "/org/mpris/MediaPlayer2";
const spotifyDbus = `<node>
<interface name="org.mpris.MediaPlayer2.Player">
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
</interface>
</node>`;

var SpTrayButton = GObject.registerClass(
    { GTypeName: 'SpTrayButton' },
    class SpTrayButton extends PanelMenu.Button {

        _init() {
            super._init(null, Me.metadata.name);

            this.ui = new Map();
            this._settingSignals = [];

            this._initSettings();
            this._initDbus();
            this._initUi();

            this.updateText();
        }

        _initSettings() {
            this.settings = ExtensionUtils.getSettings();

            // connect relevant settings to the button so that it can be instantly updated when they're changed
            // store the connected signals in an array for easy disconnection later on
            this._settingSignals.push(this.settings.connect(`changed::paused`, this.updateText.bind(this)));
            this._settingSignals.push(this.settings.connect(`changed::off`, this.updateText.bind(this)));
            this._settingSignals.push(this.settings.connect(`changed::hidden-when-inactive`, this.updateText.bind(this)));
            this._settingSignals.push(this.settings.connect(`changed::display-format`, this.updateText.bind(this)));
            this._settingSignals.push(this.settings.connect('changed::position', this._positionChanged.bind(this)));
        }

        _initUi() {
            const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
            // the 'text' variable below is what's actually shown on the tray
	    let panelLogoText = new St.Label({
		style_class: "taskbarLogoText",
		text: "",
		y_align: Clutter.ActorAlign.CENTER
	    });
            let panelButtonText = new St.Label({
                style_class: "taskbarPanelText",
                text: this.settings.get_string('starting'),
                y_align: Clutter.ActorAlign.CENTER
            });

	    this.ui.set(
		'logo',
		panelLogoText,
	    );
            this.ui.set(
                'label',
                panelButtonText,
            );

	    box.add_child(this.ui.get('logo'));
	    box.add_child(this.ui.get('label'));

            this.ui.set('box', box);

            // listen to spotify status changes to update the tray display immediately. no busy waiting
            this._settingSignals.push(this.spotifyProxy.connect("g-properties-changed", this.updateText.bind(this)));

            // TODO signals array?
            this._pressEvent = this.connect('button-press-event', this.showSpotify.bind(this));

            this.add_child(box);
        }

        _initDbus() {
            let spotifyProxyWrapper = Gio.DBusProxy.makeProxyWrapper(spotifyDbus);
            this.spotifyProxy = spotifyProxyWrapper(Gio.DBus.session, dest, path);
        }

        _positionChanged() {
            this.container.get_parent().remove_actor(this.container);

            let positions = [Main.panel._leftBox, Main.panel._centerBox, Main.panel._rightBox];

            let pos = this.settings.get_int('position');
            positions[pos].insert_child_at_index(this.container, pos == 2 ? 0 : -1);
        }

        destroy() {
            // disconnect all signals
            this._settingSignals.forEach(signal => this.settings.disconnect(signal));
            this.disconnect(this._pressEvent);
            // destroy all ui elements
            this.ui.forEach(element => element.destroy());
            super.destroy();
        }

        // update the text on the tray display
        updateText() {
            let button = this.ui.get('label');
            let status = this.spotifyProxy.PlaybackStatus;

            if (typeof (status) !== 'string') {
                let hidden = this.settings.get_boolean("hidden-when-inactive");
                if (hidden) {
                    this.visible = false;
                } else {
		    button.set_text("nothing is playing");	
                    //button.set_text(this.settings.get_string("off"));
                }
            } else {
                let metadata = this.spotifyProxy.Metadata;

                //if (status == "Paused") {
                    //let hidden = this.settings.get_boolean("hidden-when-paused");
                    //if (hidden) {
                    //    this.visible = false;
                    //} else {
			//button.set_text("not playing");    
                        //button.set_text(this.settings.get_string("paused"));
                    //}
                //} else {
                    if (!this.visible) {
                        this.visible = true;
                    }
                    let displayFormat = this.settings.get_string("display-format");

                    let title = metadata['xesam:title'].get_string()[0];
                    let album = metadata['xesam:album'].get_string()[0];
                    let artist = metadata['xesam:albumArtist'].get_strv()[0];

                    let output = displayFormat.replace("{artist}", artist).replace("{track}", title).replace("{album}", album);
                    button.set_text(output);
                //}
            }
            return true;
        }

        // many thanks to mheine's implementation
        showSpotify() {
            if (this._spotiWin && this._spotiWin.has_focus()) { // spotify is up and focused
                if (this._notSpotify) { // hide spotify and pull up the last active window if possible
                    Main.activateWindow(this._notSpotify)
                }
            } else { // spotify is unfocused or the tray icon has never been clicked before
                this._spotiWin = this._notSpotify = null;
                let wins = global.get_window_actors(); // get all open windows
                for (let win of wins) {
                    if (typeof win.get_meta_window === 'function') {
                        if (win.get_meta_window().get_wm_class() === 'Spotify') {
                            this._spotiWin = win.get_meta_window(); // mark the spotify window
                        } else if (win.get_meta_window().has_focus()) {
                            this._notSpotify = win.get_meta_window(); // mark the window that was active when the button was pressed
                        }

                        if (this._spotiWin && this._notSpotify) {
                            break;
                        }
                    }
                }
                Main.activateWindow(this._spotiWin); // pull up the spotify window
            }
        }
    }
)
