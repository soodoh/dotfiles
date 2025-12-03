# Setup for Proxmox home server

## Initial Setup
* Follow same setup indicated in the README.md (but use `apt`, per Debian-based setup)

## Build packages that are not available from the apt repositories

* Google Coral's `gasket-driver`
  * Need to git clone `google/gasket-driver`, and checkout [feranick's branch](https://github.com/google/gasket-driver/pull/50) that adds support for Kernel 6.13+
  * Per the README, run this from the top level directory to build: `debuild -us -uc -tc -b`
  * Install the `*.deb` (should be in parent directory after previous command): `dpkg -i gasket-dkms_1.0-18_all.deb`
* Build `yazi`
* Build `neovim`

## Configure udev rules for devices to work with VMs

* Setup udev rules
    * `echo 'SUBSYSTEM=="apex", MODE="0660", GROUP="apex"' > /etc/udev/rules.d/coral-tpu.rules`
    * `echo 'SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", ATTRS{serial}=="5075bd467fc9eb11a783914f1d69213e", MODE="0666", SYMLINK+="zigbee"' > /etc/udev/rules.d/hass-usb.rules`
    * `echo 'SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", ATTRS{serial}=="0001", MODE="0666", SYMLINK+="zwave"' >> /etc/udev/rules.d/hass-usb.rules`
* Reload udev rules: `udevadm control --reload-rules && udevadm trigger`
* Verify that `/dev/zigbee` & `/dev/zwave` have correct permissions and are symlinked to `/dev/ttyUSB0` (or whichever `ttyUSB*` the actual device is mapped to)


# Setup for Docker VM
