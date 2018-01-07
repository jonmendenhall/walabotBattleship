# ----------------------------------
# Variables needed for configuration
# ----------------------------------

player = 1								# which player is this Raspberry Pi + Walabot playing as
minAngle, maxAngle = -50, 50			# scanning angle boundaries of Walabot (degrees)
minDistance, maxDistance = 10, 300		# scanning distance boundaries of Walabot (cm)




# ------------------------------------------------------------------
# Import and initialize library for drawing colored text to terminal
# ------------------------------------------------------------------

from colorama import init, Fore, Back, Style

CLEARDOWN = "\33[J"			# clear everything after cursor
CLEARSCREEN = "\33[2J"		# clear whole screen
CLEARLINE = "\33[2K"		# clear the current line
CURSORHIDE = "\33[?25l"		# hide cursor
CURSORSHOW = "\33[?25h"		# show cursor

init(autoreset=True)

def moveCursor(x, y):
	return "\33[%i;%iH" % (y, x) 	# moves cursor to position in terminal

def moveUp(n):
	return "\33[%iA" % (n) 			# moves cursor up n lines




# ---------------------------------------------
# Needed to reshow the cursor at end of program
# ---------------------------------------------

import atexit

@atexit.register		# register exit() to run when program ends
def exit():
	print(CURSORSHOW) 	# set cursor to be visible




# ----------------------------------------------------------------
# Clear screen, hide cursor, print startup message, load libraries
# ----------------------------------------------------------------

print(CLEARSCREEN + CURSORHIDE + moveCursor(0, 0) + "Loading")

import WalabotAPI as bot
import pyrebase
import math
import time
import threading
import random




# -------------------------------------------------------
# Define Firebase and listener for when to start scanning
# -------------------------------------------------------

firebase = pyrebase.initialize_app({
	"apiKey": "AIzaSyD5Gkjbenem94tc2CN51W-FR0Y8PBd95tU",			# copy apiKey from firebase console
	"authDomain": "walabotBattleship.firebaseapp.com",				# PROJECT.firebaseapp.com
	"databaseURL": "https://walabotBattleship.firebaseio.com",		# https://PROJECT.firebaseio.com
	"storageBucket": "walabotBattleship.appspot.com"				# PROJECT.appspot.com
}).database()

def handle(msg):
	global scanning
	now = msg["data"] != 0													# whether the program should be scanning or not based on value at "/PLAYER/mode" in database
	print(moveCursor(0, 3) + CLEARLINE + "Scanning: ", end="")				# print to screen "Scanning: False" (RED) or "Scanning: True" (GREEN)
	print((Fore.GREEN if now else Fore.RED) + Style.BRIGHT + str(now))

	if now != scanning:									# only handle changes in scanning state, not changes in value
		scanning = now									# set scanning to updated value
		if scanning:
			thread = threading.Thread(target=scan)		# start scan thread if it should be scanning
			thread.start()




# -----------------------------------------
# Create class for interfacing with Walabot
# -----------------------------------------

class Walabot:

	def __init__(self):				# initialize WalabotAPI
		bot.Init()
		bot.SetSettingsFolder()		

	def connect(self):												# connect to Walabot
		while True:													# keep trying until successful
			try:
				bot.ConnectAny()									# try to connect
			except bot.WalabotError as e:
				if e.code == 19:									# error code 19 means Walabot is not connected with the usb cable
					input("Connect Walabot and press enter")		# ask user to connect Walabot
			else:
				print("Connected to Walabot")						# successfully connected
				return												# exit the loop

	def start(self):																				# begin calibration and prepare for scanning
		bot.SetProfile(bot.PROF_SENSOR)																# set Walabot properties
		bot.SetArenaR(minDistance, maxDistance, 5)
		bot.SetArenaTheta(-1, 1, 1)
		bot.SetArenaPhi(minAngle, maxAngle, 5)
		bot.SetThreshold(60)
		bot.SetDynamicImageFilter(bot.FILTER_TYPE_NONE)

		bot.Start()  																				# start calibration 
		bot.StartCalibration()
		print("Calibrating")

		while bot.GetStatus()[0] == bot.STATUS_CALIBRATING:											# wait for calibration to end
			bot.Trigger()																			# calibration process Walabot
			print(".", end="")

		print(CLEARSCREEN + moveCursor(0,1) + "Calibrated: " + Fore.CYAN + Style.BRIGHT + "True")	# done calibrating
		print(Style.RESET_ALL + "Player: " + Fore.YELLOW + Style.BRIGHT + str(player))

	def targets(self):
		bot.Trigger()
		targets = bot.GetSensorTargets()										# get targets from walabot
		positions = []

		for target in targets:													# loop through all targets found
			angle = math.degrees(math.atan(target.yPosCm / target.zPosCm))		# find angle of target on horizontal axis
			distance = (target.yPosCm ** 2 + target.zPosCm ** 2) ** 0.5			# find radial distance to Walabot
			positions.append((angle, distance))									# add (angle, distance) to list
		
		return positions														# return found positions




# -----------------------------------
# Variables and methods for scan loop
# -----------------------------------

scanning = False									# is currently scanning
lastSector = ""										# last recorded sector
lastCount = 0										# last number of targets found
sectors = ["north", "east", "south", "west"]		# list of sector names

def remap(x, imin, imax, omin, omax):							# convert x in (imin <-> imax) to (omin <-> omax)
	return (x - imin) / (imax - imin) * (omax - omin) + omin

def scan():
	global scanning, lastSector, lastCount

	# print lastSector to screen
	print(moveCursor(0,4) + CLEARLINE + "Sector: %s%s" % (Style.BRIGHT, (Fore.RED + "None") if lastSector == "" else (Fore.YELLOW + lastSector)))
	
	# only upload new positions while scanning (while "/PLAYER/mode" == 1 or 2)
	while scanning:
		try:

			targets = walabot.targets()			# get player position from walabot
			count = len(targets)

			print(moveCursor(0,4))				# clear list of targets from screen
			if count < lastCount:
				print(CLEARDOWN, end="")


			if count > 0:								# only calculate if we found more than 0 targets
				sumAngle, sumDistance = 0, 0			# sum of angles and distances

				for i in range(0, count):				# find average angle and distance of the targets
					angle, distance = targets[i]
					sumAngle += angle
					sumDistance += distance

					# print target, angle, and distance to screen
					print(CLEARLINE + "Target: " + Fore.YELLOW + Style.BRIGHT + str(i) + Style.RESET_ALL + " Angle: %s%.2f %sDistance: %s%.2f" % (Fore.YELLOW + Style.BRIGHT, angle, Style.RESET_ALL, Fore.YELLOW + Style.BRIGHT, distance))

				# convert angle and distance into one of the 4 compass sectors
				sector = sectors[(round(remap(sumAngle / count, minAngle, maxAngle, 0, 3)) + round(remap(sumDistance / count, minDistance, maxDistance, 0, 2))) % 4]
				
				# IF CHANGED, send new sector to "/PLAYER/sector" in database
				if sector != lastSector or lastCount == 0:

					# print position to screen
					print(moveCursor(0,4) + CLEARLINE + "Sector: %s" % (Fore.YELLOW + Style.BRIGHT + sector))

					# upload position
					firebase.child("/%d/sector" % (player)).set(sector)
					lastSector = sector


				# move back to top of list for next print cycle
				print(moveUp(count), end="")

			# didnt find any targets this time
			elif lastCount > 0:

				# print "Sector: None" to screen
				print(moveCursor(0,4) + CLEARLINE + "Sector: %s" % (Fore.RED + Style.BRIGHT + "None"))

			# update lastCount with count
			lastCount = count

		except Exception as e:

			# print any error caught
			print("Error: %s" % (e))




# ---------------------------------------------------------
# Main start, begin listening for updates to "/PLAYER/mode"
# ---------------------------------------------------------

walabot = Walabot()												# create Walabot connection
walabot.connect()												# connect
walabot.start()													# calibrate
stream = firebase.child("/%d/mode" % (player)).stream(handle) 	# listen for updates with function handle(msg)






