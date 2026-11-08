#!/usr/bin/env python3
"""A BLE sensor peripheral on the host's own adapter, for driving the app's
sensor link on a handset without a strap or a meter.

It serves the standard profiles the app subscribes to, Heart Rate (0x180D),
Cycling Power (0x1818), Cycling Speed and Cadence (0x1816), Running Speed and
Cadence (0x1814) and Battery (0x180F), over BlueZ's D-Bus GATT server, and
advertises them under one local name. Every connect, subscription, read and
unsubscribe is printed with a timestamp, so the peripheral side of a link can be
laid beside the handset's logcat.

Commands are read from stdin, one per line, and can be scheduled:

    stream on|off          push a measurement every tick on each subscribed characteristic
    rate HZ                notifications per second (default 1)
    add rsc                register the Running Speed and Cadence service after the fact,
                           which makes BlueZ send Service Changed to a subscribed client
    drop                   disconnect every connected central
    adv on|off             start or stop advertising
    power on|off           power the adapter off and on
    after SECONDS COMMAND  run COMMAND after SECONDS
    status                 print what is connected and subscribed
    quit

Run it with a script of commands on stdin or interactively:

    printf 'stream off\nafter 35 stream on\n' | python3 scripts/ble-sensor-peripheral.py --name "Bench sensor"
"""

import argparse
import struct
import sys
import time

import dbus
import dbus.mainloop.glib
import dbus.service
from gi.repository import GLib

BLUEZ = 'org.bluez'
ADAPTER_IFACE = 'org.bluez.Adapter1'
DEVICE_IFACE = 'org.bluez.Device1'
GATT_MANAGER_IFACE = 'org.bluez.GattManager1'
GATT_SERVICE_IFACE = 'org.bluez.GattService1'
GATT_CHRC_IFACE = 'org.bluez.GattCharacteristic1'
LE_ADVERTISING_MANAGER_IFACE = 'org.bluez.LEAdvertisingManager1'
LE_ADVERTISEMENT_IFACE = 'org.bluez.LEAdvertisement1'
DBUS_OM_IFACE = 'org.freedesktop.DBus.ObjectManager'
DBUS_PROP_IFACE = 'org.freedesktop.DBus.Properties'

HEART_RATE_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb'
HEART_RATE_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb'
CYCLING_POWER_SERVICE = '00001818-0000-1000-8000-00805f9b34fb'
CYCLING_POWER_MEASUREMENT = '00002a63-0000-1000-8000-00805f9b34fb'
CSC_SERVICE = '00001816-0000-1000-8000-00805f9b34fb'
CSC_MEASUREMENT = '00002a5b-0000-1000-8000-00805f9b34fb'
RSC_SERVICE = '00001814-0000-1000-8000-00805f9b34fb'
RSC_MEASUREMENT = '00002a53-0000-1000-8000-00805f9b34fb'
BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb'
BATTERY_LEVEL = '00002a19-0000-1000-8000-00805f9b34fb'

SHORT = {
    HEART_RATE_MEASUREMENT: 'hr',
    CYCLING_POWER_MEASUREMENT: 'power',
    CSC_MEASUREMENT: 'csc',
    RSC_MEASUREMENT: 'rsc',
    BATTERY_LEVEL: 'battery',
}

STARTED = time.time()


def log(message):
    now = time.time()
    print(f'+{now - STARTED:8.3f}s {time.strftime("%H:%M:%S", time.localtime(now))} {message}', flush=True)


class InvalidArgsException(dbus.exceptions.DBusException):
    _dbus_error_name = 'org.freedesktop.DBus.Error.InvalidArgs'


class Application(dbus.service.Object):
    """One GATT application: BlueZ reads its services through ObjectManager."""

    def __init__(self, bus, path):
        self.path = path
        self.services = []
        dbus.service.Object.__init__(self, bus, self.path)

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def add_service(self, service):
        self.services.append(service)

    @dbus.service.method(DBUS_OM_IFACE, out_signature='a{oa{sa{sv}}}')
    def GetManagedObjects(self):
        response = {}
        for service in self.services:
            response[service.get_path()] = service.get_properties()
            for chrc in service.characteristics:
                response[chrc.get_path()] = chrc.get_properties()
        return response


class Service(dbus.service.Object):
    def __init__(self, bus, path, uuid):
        self.path = path
        self.uuid = uuid
        self.characteristics = []
        dbus.service.Object.__init__(self, bus, self.path)

    def get_properties(self):
        return {
            GATT_SERVICE_IFACE: {
                'UUID': self.uuid,
                'Primary': True,
                'Characteristics': dbus.Array(
                    [c.get_path() for c in self.characteristics], signature='o'
                ),
            }
        }

    def get_path(self):
        return dbus.ObjectPath(self.path)

    def add_characteristic(self, chrc):
        self.characteristics.append(chrc)

    @dbus.service.method(DBUS_PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        if interface != GATT_SERVICE_IFACE:
            raise InvalidArgsException()
        return self.get_properties()[GATT_SERVICE_IFACE]


class Characteristic(dbus.service.Object):
    def __init__(self, bus, index, uuid, flags, service, frame):
        self.path = service.path + '/char' + str(index)
        self.uuid = uuid
        self.service = service
        self.flags = flags
        self.frame = frame
        self.notifying = False
        self.sent = 0
        dbus.service.Object.__init__(self, bus, self.path)

    def get_properties(self):
        return {
            GATT_CHRC_IFACE: {
                'Service': self.service.get_path(),
                'UUID': self.uuid,
                'Flags': self.flags,
            }
        }

    def get_path(self):
        return dbus.ObjectPath(self.path)

    @dbus.service.method(DBUS_PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        if interface != GATT_CHRC_IFACE:
            raise InvalidArgsException()
        return self.get_properties()[GATT_CHRC_IFACE]

    @dbus.service.signal(DBUS_PROP_IFACE, signature='sa{sv}as')
    def PropertiesChanged(self, interface, changed, invalidated):
        pass

    @dbus.service.method(GATT_CHRC_IFACE, in_signature='a{sv}', out_signature='ay')
    def ReadValue(self, options):
        value = self.frame(0)
        log(f'read {SHORT[self.uuid]} from {options.get("device", "?")}')
        return dbus.Array(value, signature='y')

    @dbus.service.method(GATT_CHRC_IFACE)
    def StartNotify(self):
        self.notifying = True
        log(f'subscribe {SHORT[self.uuid]} (notifications enabled by a client)')

    @dbus.service.method(GATT_CHRC_IFACE)
    def StopNotify(self):
        self.notifying = False
        log(f'unsubscribe {SHORT[self.uuid]} (notifications disabled, {self.sent} sent)')

    def push(self, tick):
        if not self.notifying:
            return
        self.sent += 1
        value = self.frame(tick)
        self.PropertiesChanged(GATT_CHRC_IFACE, {'Value': dbus.Array(value, signature='y')}, [])


def heart_rate_frame(tick):
    # Flags 0: an 8-bit rate follows.
    return [0x00, 120 + (tick % 20)]


def cycling_power_frame(tick):
    # Flags bit 5: crank revolution data present.
    revs = tick % 0x10000
    event_time = (tick * 1024) % 0x10000
    return list(struct.pack('<HhHH', 0x0020, 200 + (tick % 15), revs, event_time))


def csc_frame(tick):
    # Flags bits 0 and 1: wheel and crank data present.
    wheel_revs = tick % 0x100000000
    wheel_time = (tick * 1024) % 0x10000
    crank_revs = tick % 0x10000
    crank_time = (tick * 1024) % 0x10000
    return list(struct.pack('<BIHHH', 0x03, wheel_revs, wheel_time, crank_revs, crank_time))


def rsc_frame(tick):
    # Flags 0: speed in 1/256 m/s and cadence in steps per minute, no stride or distance.
    speed = int(3.2 * 256)
    return list(struct.pack('<BHB', 0x00, speed, 170 + (tick % 5)))


def battery_frame(_tick):
    return [77]


class Advertisement(dbus.service.Object):
    def __init__(self, bus, path, name, uuids):
        self.path = path
        self.name = name
        self.uuids = uuids
        dbus.service.Object.__init__(self, bus, self.path)

    def get_properties(self):
        return {
            LE_ADVERTISEMENT_IFACE: {
                'Type': 'peripheral',
                'ServiceUUIDs': dbus.Array(self.uuids, signature='s'),
                'LocalName': dbus.String(self.name),
                'Includes': dbus.Array(['tx-power'], signature='s'),
            }
        }

    def get_path(self):
        return dbus.ObjectPath(self.path)

    @dbus.service.method(DBUS_PROP_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        if interface != LE_ADVERTISEMENT_IFACE:
            raise InvalidArgsException()
        return self.get_properties()[LE_ADVERTISEMENT_IFACE]

    @dbus.service.method(LE_ADVERTISEMENT_IFACE)
    def Release(self):
        log('advertisement released by BlueZ')


class Peripheral:
    def __init__(self, bus, adapter_path, name):
        self.bus = bus
        self.adapter_path = adapter_path
        self.name = name
        self.adapter = dbus.Interface(bus.get_object(BLUEZ, adapter_path), DBUS_PROP_IFACE)
        self.gatt_manager = dbus.Interface(bus.get_object(BLUEZ, adapter_path), GATT_MANAGER_IFACE)
        self.ad_manager = dbus.Interface(
            bus.get_object(BLUEZ, adapter_path), LE_ADVERTISING_MANAGER_IFACE
        )
        self.characteristics = []
        self.streaming = True
        self.rate_hz = 1.0
        self.tick = 0
        self.tick_source = None
        self.advertising = False
        self.rsc_app = None
        self.loop = None
        self.main_app = self.build_main_app()
        self.advertisement = Advertisement(
            bus,
            '/org/bench/sensor/advertisement0',
            name,
            [HEART_RATE_SERVICE, CYCLING_POWER_SERVICE, CSC_SERVICE],
        )
        bus.add_signal_receiver(
            self.on_properties_changed,
            dbus_interface=DBUS_PROP_IFACE,
            signal_name='PropertiesChanged',
            path_keyword='path',
        )

    def build_main_app(self):
        app = Application(self.bus, '/org/bench/sensor/app0')
        services = [
            (HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, ['notify'], heart_rate_frame),
            (CYCLING_POWER_SERVICE, CYCLING_POWER_MEASUREMENT, ['notify'], cycling_power_frame),
            (CSC_SERVICE, CSC_MEASUREMENT, ['notify'], csc_frame),
            (BATTERY_SERVICE, BATTERY_LEVEL, ['read'], battery_frame),
        ]
        for index, (service_uuid, chrc_uuid, flags, frame) in enumerate(services):
            service = Service(self.bus, f'{app.path}/service{index}', service_uuid)
            chrc = Characteristic(self.bus, 0, chrc_uuid, flags, service, frame)
            service.add_characteristic(chrc)
            app.add_service(service)
            self.characteristics.append(chrc)
        return app

    def register_app(self, app, label):
        self.gatt_manager.RegisterApplication(
            app.get_path(),
            {},
            reply_handler=lambda: log(f'{label} registered with BlueZ'),
            error_handler=lambda e: log(f'{label} registration failed: {e}'),
        )

    def start(self):
        self.register_app(self.main_app, 'GATT application (HR, power, CSC, battery)')
        self.advertise(True)
        self.set_rate(self.rate_hz)

    def advertise(self, on):
        if on and not self.advertising:
            self.ad_manager.RegisterAdvertisement(
                self.advertisement.get_path(),
                {},
                reply_handler=lambda: log('advertising on'),
                error_handler=lambda e: log(f'advertising failed: {e}'),
            )
            self.advertising = True
        elif not on and self.advertising:
            try:
                self.ad_manager.UnregisterAdvertisement(self.advertisement.get_path())
                log('advertising off')
            except dbus.exceptions.DBusException as e:
                log(f'advertising off failed: {e}')
            self.advertising = False

    def set_rate(self, hz):
        self.rate_hz = hz
        if self.tick_source is not None:
            GLib.source_remove(self.tick_source)
        self.tick_source = GLib.timeout_add(int(1000 / hz), self.on_tick)

    def on_tick(self):
        self.tick += 1
        if self.streaming:
            for chrc in self.characteristics:
                chrc.push(self.tick)
        return True

    def add_rsc(self):
        if self.rsc_app is not None:
            log('RSC already registered')
            return
        app = Application(self.bus, '/org/bench/sensor/app1')
        service = Service(self.bus, f'{app.path}/service0', RSC_SERVICE)
        chrc = Characteristic(self.bus, 0, RSC_MEASUREMENT, ['notify'], service, rsc_frame)
        service.add_characteristic(chrc)
        app.add_service(service)
        self.characteristics.append(chrc)
        self.rsc_app = app
        self.register_app(app, 'second GATT application (RSC)')

    def connected_devices(self):
        om = dbus.Interface(self.bus.get_object(BLUEZ, '/'), DBUS_OM_IFACE)
        found = []
        for path, interfaces in om.GetManagedObjects().items():
            device = interfaces.get(DEVICE_IFACE)
            if device and device.get('Connected') and path.startswith(self.adapter_path):
                found.append((path, str(device.get('Address'))))
        return found

    def drop(self):
        devices = self.connected_devices()
        if not devices:
            log('drop: nothing connected')
        for path, address in devices:
            log(f'drop: disconnecting {address}')
            dbus.Interface(self.bus.get_object(BLUEZ, path), DEVICE_IFACE).Disconnect(
                reply_handler=lambda a=address: log(f'drop: {a} disconnected'),
                error_handler=lambda e, a=address: log(f'drop: {a} failed: {e}'),
            )

    def power(self, on):
        self.adapter.Set(ADAPTER_IFACE, 'Powered', dbus.Boolean(on))
        log(f'adapter powered {"on" if on else "off"}')
        if on:
            # BlueZ keeps the advertisement object registered across a power
            # cycle and advertises nothing, and a second register is refused as
            # already existing: unregister it first, then register it again.
            try:
                self.ad_manager.UnregisterAdvertisement(self.advertisement.get_path())
            except dbus.exceptions.DBusException:
                pass
            self.advertising = False
            self.advertise(True)

    def on_properties_changed(self, interface, changed, invalidated, path=None):
        if interface != DEVICE_IFACE or not str(path).startswith(self.adapter_path):
            return
        if 'Connected' in changed:
            address = path.rsplit('dev_', 1)[-1].replace('_', ':')
            log(f'central {address} {"connected" if changed["Connected"] else "disconnected"}')
        if 'ServicesResolved' in changed and changed['ServicesResolved']:
            log(f'central at {path} resolved services')

    def status(self):
        subscribed = [SHORT[c.uuid] for c in self.characteristics if c.notifying]
        devices = [a for _, a in self.connected_devices()]
        log(
            f'status: connected={devices or "none"} subscribed={subscribed or "none"} '
            f'streaming={self.streaming} rate={self.rate_hz}Hz advertising={self.advertising}'
        )

    def run_scheduled(self, line):
        if not self.command(line) and self.loop is not None:
            self.loop.quit()
        return False

    def command(self, line):
        words = line.strip().split()
        if not words:
            return True
        verb, args = words[0], words[1:]
        try:
            if verb == 'after' and len(args) >= 2:
                delay = float(args[0])
                rest = ' '.join(args[1:])
                log(f'scheduled in {delay:g}s: {rest}')
                GLib.timeout_add(int(delay * 1000), lambda: self.run_scheduled(rest))
            elif verb == 'stream' and args:
                self.streaming = args[0] == 'on'
                log(f'stream {"on" if self.streaming else "off"}')
            elif verb == 'rate' and args:
                self.set_rate(float(args[0]))
                log(f'rate {self.rate_hz:g} Hz')
            elif verb == 'add' and args and args[0] == 'rsc':
                self.add_rsc()
            elif verb == 'drop':
                self.drop()
            elif verb == 'adv' and args:
                self.advertise(args[0] == 'on')
            elif verb == 'power' and args:
                self.power(args[0] == 'on')
            elif verb == 'status':
                self.status()
            elif verb == 'quit':
                return False
            else:
                log(f'unknown command: {line.strip()}')
        except dbus.exceptions.DBusException as e:
            log(f'{verb} failed: {e}')
        return True


def find_adapter(bus):
    om = dbus.Interface(bus.get_object(BLUEZ, '/'), DBUS_OM_IFACE)
    for path, interfaces in om.GetManagedObjects().items():
        if GATT_MANAGER_IFACE in interfaces and LE_ADVERTISING_MANAGER_IFACE in interfaces:
            return path
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--name', default='Bench sensor', help='the advertised local name')
    parser.add_argument('--adapter', default=None, help='the adapter object path, found when omitted')
    args = parser.parse_args()

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    adapter_path = args.adapter or find_adapter(bus)
    if adapter_path is None:
        print('no adapter with GATT and advertising managers', file=sys.stderr)
        return 1

    address = dbus.Interface(bus.get_object(BLUEZ, adapter_path), DBUS_PROP_IFACE).Get(
        ADAPTER_IFACE, 'Address'
    )
    log(f'adapter {adapter_path} {address}, advertising as "{args.name}"')
    peripheral = Peripheral(bus, adapter_path, args.name)
    peripheral.start()

    loop = GLib.MainLoop()
    peripheral.loop = loop

    def on_stdin(channel, condition):
        if condition & GLib.IO_HUP:
            log('stdin closed, running until quit or signal')
            return False
        line = channel.readline()
        if line == '':
            return False
        if not peripheral.command(line):
            loop.quit()
        return True

    GLib.io_add_watch(GLib.IOChannel.unix_new(sys.stdin.fileno()), GLib.IO_IN | GLib.IO_HUP, on_stdin)
    try:
        loop.run()
    except KeyboardInterrupt:
        pass
    peripheral.advertise(False)
    log('stopped')
    return 0


if __name__ == '__main__':
    sys.exit(main())
