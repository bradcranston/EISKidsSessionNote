/* FileMaker Calculation - Sample Session Note Data for Testing
   
   This calculation creates a JSON object with sample data to test the populateForm function.
   
   Usage in FileMaker:
   1. Copy this calculation into a FileMaker script step
   2. Perform JavaScript in Web Viewer [ "populateForm(" & <this calculation> & ")" ]
   
   OR for testing directly in the web viewer console:
   1. Copy the result of this calculation
   2. In browser console, run: window.populateForm(<paste result here>)
*/

JSONSetElement ( "{}" ;

  // Header Information
  [ "county" ; "EILAN" ; JSONString ] ;
  [ "staffId" ; "ST12345" ; JSONString ] ;
  [ "travelMinutes" ; 15 ; JSONNumber ] ;
  [ "unitJustification" ; "Standard home visit" ; JSONString ] ;
  
  // Session Details
  [ "localId" ; "LOC987654" ; JSONString ] ;
  [ "sessionDate" ; "2026-02-10" ; JSONString ] ;
  [ "sessionStartTime" ; "10:00" ; JSONString ] ;
  [ "sessionEndTime" ; "11:00" ; JSONString ] ;
  [ "serviceUnits" ; 2.5 ; JSONNumber ] ;
  
  // Client Information
  [ "clientFirstName" ; "Emma" ; JSONString ] ;
  [ "clientLastName" ; "Johnson" ; JSONString ] ;
  [ "serviceCode" ; "SP22" ; JSONString ] ;
  [ "sessionType" ; "Ongoing" ; JSONString ] ;
  [ "location" ; "Home" ; JSONString ] ;
  
  // IFSP/IEP Information
  [ "ifspOutcomes" ; "Emma will improve expressive language skills to communicate needs and wants during daily routines" ; JSONString ] ;
  [ "specificTargets" ; "Use 2-3 word phrases during mealtime and playtime; Point to and name preferred items" ; JSONString ] ;
  
  // Session Documentation
  [ "outcomeUpdates" ; "Emma has been using more verbal approximations at home. Parents report she is attempting to say 'more' and 'all done' during snack time. She consistently uses pointing to indicate wants." ; JSONString ] ;
  [ "whatWeDidToday" ; "We practiced communication strategies during playtime and snack routines. Emma and her mother engaged in turn-taking activities with preferred toys. I demonstrated modeling simple phrases like 'my turn' and 'want ball.' Mother practiced waiting for Emma's communication attempts before providing requested items. Emma successfully used 2-word phrases ('want cookie', 'more juice') 4 times during the 15-minute snack routine. Present: Mother and Emma." ; JSONString ] ;
  
  // Coaching Strategies (Checkboxes)
  [ "coachingOb" ; True ; JSONBoolean ] ;
  [ "coachingDT" ; False ; JSONBoolean ] ;
  [ "coachingDemN" ; True ; JSONBoolean ] ;
  [ "coachingGP" ; True ; JSONBoolean ] ;
  [ "coachingCP" ; True ; JSONBoolean ] ;
  [ "coachingSF" ; True ; JSONBoolean ] ;
  [ "coachingPS" ; False ; JSONBoolean ] ;
  [ "coachingRe" ; True ; JSONBoolean ] ;
  [ "coachingOther" ; "" ; JSONString ] ;
  
  // Target Progress (Radio buttons)
  [ "target1Progress" ; "Some/partial target use" ; JSONString ] ;
  [ "target2Progress" ; "Completed target as described" ; JSONString ] ;
  
  // Family Plan
  [ "whatTargets" ; "Emma will use 2-3 word phrases during snack time and play activities; Emma will respond to simple questions with verbal or gestural responses" ; JSONString ] ;
  [ "howActivities" ; "Wait for Emma to initiate communication before providing items; Model simple 2-word phrases; Expand on Emma's attempts by adding one word; Use visual supports (pictures) alongside verbal models" ; JSONString ] ;
  [ "whenWhere" ; "During meals and snack time in the kitchen; During play time in the living room; During bath time routine" ; JSONString ] ;
  [ "who" ; "Mom, Dad, and Grandma" ; JSONString ] ;
  [ "successLooks" ; "Emma will use verbal communication to request preferred items at least 3 times per routine without prompting" ; JSONString ] ;
  
  // Staff Information
  [ "eIFirstName" ; "Sarah" ; JSONString ] ;
  [ "eILastName" ; "Martinez" ; JSONString ] ;
  [ "eICredentials" ; "MS, CCC-SLP" ; JSONString ] ;
  [ "eIPhone" ; "717-555-0123" ; JSONString ] ;
  
  // Parent/Caregiver Information
  [ "parentFirstName" ; "Jennifer" ; JSONString ] ;
  [ "parentLastName" ; "Johnson" ; JSONString ] ;
  
  // Signatures (Base64 encoded - these are 1x1 pixel test images)
  [ "eISignatureBase64" ; "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" ; JSONString ] ;
  [ "parentSignatureBase64" ; "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" ; JSONString ] ;
  
  // Service Coordinator
  [ "serviceCoordinatorName" ; "Lisa" ; JSONString ] ;
  [ "serviceCoordinatorLastName" ; "Thompson" ; JSONString ] ;
  
  // Next Session
  [ "nextSessionDate" ; "2026-02-17" ; JSONString ] ;
  [ "nextSessionTime" ; "10:00" ; JSONString ]
)
